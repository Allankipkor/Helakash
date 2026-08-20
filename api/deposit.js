import { query, getAppId, getTables } from './db.js';

export default async function handler(req, res) {
  const appId = getAppId(req);
  const tables = getTables(req);

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { amount, phone, accountPhone } = req.body;
  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone number are required.' });
  }

  let minDeposit = 300.00;
  let username = null;
  let password = null;
  let channelId = null;
  let callbackUrl = null;

  try {
    let settingsQuery = await query(`SELECT * FROM ${tables.settings} WHERE id = $1;`, [appId]);
    if (settingsQuery.rows.length === 0) {
      settingsQuery = await query(`SELECT * FROM ${tables.settings} LIMIT 1;`);
    }
    if (settingsQuery.rows.length > 0) {
      const dbSettings = settingsQuery.rows[0];
      minDeposit = parseFloat(dbSettings.min_deposit || 300.00);
      username = dbSettings.payhero_username || null;
      password = dbSettings.payhero_password || null;
      channelId = dbSettings.payhero_channel_id || null;
      callbackUrl = dbSettings.payhero_callback_url || null;
    }
  } catch (dbErr) {
    console.error("Failed to fetch settings from DB in deposit.js:", dbErr.message);
  }

  if (parseInt(amount) < minDeposit) {
    return res.status(400).json({ error: `Minimum deposit amount is KES ${minDeposit}.` });
  }

  // Clean payment phone number (receives the STK push prompt)
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  if (!/^254[71]\d{8}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format. Please use 07XXXXXXXX or 7XXXXXXXX.' });
  }

  // Clean account phone number (game user account that gets credited)
  const targetAccountPhone = accountPhone || phone;
  let cleanAccountPhone = targetAccountPhone.replace(/\D/g, '');
  if (cleanAccountPhone.startsWith('0')) {
    cleanAccountPhone = '254' + cleanAccountPhone.substring(1);
  } else if (cleanAccountPhone.startsWith('7') || cleanAccountPhone.startsWith('1')) {
    cleanAccountPhone = '254' + cleanAccountPhone;
  }

  if (!/^254[71]\d{8}$/.test(cleanAccountPhone)) {
    return res.status(400).json({ error: 'Invalid account phone number format.' });
  }

  const cleanEnvVar = (val) => {
    if (!val) return val;
    let clean = val.trim();
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
      clean = clean.slice(1, -1);
    }
    return clean.trim();
  };

  // Fallback to env vars if database settings are not set
  if (!username) username = cleanEnvVar(process.env.PAYHERO_USERNAME);
  if (!password) password = cleanEnvVar(process.env.PAYHERO_PASSWORD);
  if (!channelId) channelId = cleanEnvVar(process.env.PAYHERO_CHANNEL_ID);
  if (!callbackUrl) {
    callbackUrl = cleanEnvVar(process.env.PAYHERO_CALLBACK_URL);
    if (!callbackUrl && req.headers && req.headers.host) {
      const protocol = req.headers.host.includes('localhost') || req.headers.host.includes('127.0.0.1') ? 'http' : 'https';
      callbackUrl = `${protocol}://${req.headers.host}/api/callback`;
    }
  }

  // Fallback to SIMULATED mode if credentials are missing
  if (!username || !password || !channelId) {
    console.log("Pay Hero API credentials not configured. Running in SIMULATED mode.");

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    const reference = `SIM-${appId.toUpperCase()}-${Date.now()}`;

    try {
      // Ensure user exists in DB
      await query(`
        INSERT INTO ${tables.users} (phone, balance, password_hash)
        VALUES ($1, 0.00, 'NO_PASSWORD_MIGRATED')
        ON CONFLICT (phone) DO NOTHING;
      `, [cleanAccountPhone]);

      // Update balance directly in simulated mode
      await query(`
        UPDATE ${tables.users}
        SET balance = balance + $1
        WHERE phone = $2;
      `, [parseFloat(amount), cleanAccountPhone]);

      // Log transaction in DB
      await query(`
        INSERT INTO ${tables.transactions} (phone, type, amount, status, reference)
        VALUES ($1, 'Deposit', $2, 'Success', $3);
      `, [cleanAccountPhone, parseFloat(amount), reference]);
    } catch (dbErr) {
      console.error("Database transaction logging failed:", dbErr.message);
    }

    return res.status(200).json({
      success: true,
      message: "STK push initiated successfully (SIMULATED)",
      reference: reference,
      simulated: true
    });
  }

  try {
    const reference = `${appId.toUpperCase()}-${Date.now()}`;
    const payload = {
      amount: parseInt(amount),
      phone_number: cleanPhone,
      channel_id: parseInt(channelId),
      provider: 'm-pesa',
      external_reference: reference
    };

    if (callbackUrl) {
      payload.callback_url = callbackUrl;
    }

    // Ensure user exists in DB
    await query(`
      INSERT INTO ${tables.users} (phone, balance, password_hash)
      VALUES ($1, 0.00, 'NO_PASSWORD_MIGRATED')
      ON CONFLICT (phone) DO NOTHING;
    `, [cleanAccountPhone]);

    // Log pending transaction in DB
    await query(`
      INSERT INTO ${tables.transactions} (phone, type, amount, status, reference)
      VALUES ($1, 'Deposit', $2, 'PENDING', $3);
    `, [cleanAccountPhone, parseFloat(amount), reference]);

    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    const response = await fetch('https://backend.payhero.co.ke/api/v2/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify(payload)
    });

    let data;
    try {
      data = await response.json();
    } catch (e) {
      data = null;
    }

    if (!response.ok) {
      // Mark transaction as failed in DB
      await query(`
        UPDATE ${tables.transactions} 
        SET status = 'FAILED' 
        WHERE reference = $1;
      `, [reference]);

      console.error("Pay Hero STK push failure response status:", response.status);
      console.error("Pay Hero STK push failure data:", data);

      let errorMessage = 'Pay Hero API Error';
      if (data) {
        if (typeof data.error_message === 'string') {
          errorMessage = data.error_message;
        } else if (typeof data.message === 'string') {
          errorMessage = data.message;
        } else if (typeof data.error === 'string') {
          errorMessage = data.error;
        } else if (data.errors && typeof data.errors === 'object') {
          errorMessage = JSON.stringify(data.errors);
        } else if (typeof data === 'string') {
          errorMessage = data;
        } else {
          errorMessage = JSON.stringify(data);
        }
      }

      if (errorMessage.includes("merchant has insufficient balance")) {
        errorMessage = "The merchant's payment service wallet has insufficient float balance. Please contact the site administrator to top up the Pay Hero wallet.";
      }

      return res.status(response.status).json({ error: errorMessage });
    }

    return res.status(200).json({
      success: true,
      message: data.message || 'STK Push initiated successfully',
      reference: reference,
      response: data
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
