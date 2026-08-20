import { query, getAppId, getTables, normalizePhoneVariants, findUserOrImport, ensureUser } from './db.js';

export default async function handler(req, res) {
  const appId = getAppId(req);
  const tables = getTables(req);

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { amount, phone, accountPhone } = req.body || {};
  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone number are required.' });
  }

  let minDeposit = 300.00;
  let activeGateway = 'payhero';
  let username = null;
  let password = null;
  let channelId = null;
  let callbackUrl = null;
  let tinypesaApiKey = null;
  let tinypesaAccountNo = null;

  try {
    let settingsQuery = await query(`SELECT * FROM ${tables.settings} WHERE id = $1;`, [appId]);
    if (settingsQuery.rows.length === 0) {
      settingsQuery = await query(`SELECT * FROM ${tables.settings} LIMIT 1;`);
    }
    if (settingsQuery.rows.length > 0) {
      const dbSettings = settingsQuery.rows[0];
      minDeposit = parseFloat(dbSettings.min_deposit || 300.00);
      activeGateway = (dbSettings.active_gateway || 'payhero').toLowerCase().trim();
      username = dbSettings.payhero_username || null;
      password = dbSettings.payhero_password || null;
      channelId = dbSettings.payhero_channel_id || null;
      callbackUrl = dbSettings.payhero_callback_url || null;
      tinypesaApiKey = dbSettings.tinypesa_api_key || null;
      tinypesaAccountNo = dbSettings.tinypesa_account_no || null;
    }
  } catch (dbErr) {
    console.error("Failed to fetch settings from DB in deposit.js:", dbErr.message);
  }

  const depositAmount = parseFloat(amount);
  if (isNaN(depositAmount) || depositAmount < minDeposit) {
    return res.status(400).json({ error: `Minimum deposit amount is KES ${minDeposit}.` });
  }

  // Payment phone number (receives the STK push prompt)
  const { phone254: payPhone254, phone0: payPhone0, primary: payPhonePrimary } = normalizePhoneVariants(phone);
  if (!/^254[71]\d{8}$/.test(payPhone254)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format. Please use 07XXXXXXXX or 7XXXXXXXX.' });
  }

  // Target account phone (user account that gets credited)
  const targetAccountPhone = accountPhone || phone;
  const { phone254, phone0, phoneShort, primary: accountPrimary } = normalizePhoneVariants(targetAccountPhone);

  if (!/^254[71]\d{8}$/.test(phone254)) {
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
  if (!activeGateway) activeGateway = (cleanEnvVar(process.env.ACTIVE_GATEWAY) || 'payhero').toLowerCase();
  if (!username) username = cleanEnvVar(process.env.PAYHERO_USERNAME);
  if (!password) password = cleanEnvVar(process.env.PAYHERO_PASSWORD);
  if (!channelId) channelId = cleanEnvVar(process.env.PAYHERO_CHANNEL_ID);
  if (!tinypesaApiKey) tinypesaApiKey = cleanEnvVar(process.env.TINYPESA_API_KEY);
  if (!tinypesaAccountNo) tinypesaAccountNo = cleanEnvVar(process.env.TINYPESA_ACCOUNT_NO);
  if (!callbackUrl) {
    callbackUrl = cleanEnvVar(process.env.PAYHERO_CALLBACK_URL);
    if (!callbackUrl && req.headers && req.headers.host) {
      const protocol = req.headers.host.includes('localhost') || req.headers.host.includes('127.0.0.1') ? 'http' : 'https';
      callbackUrl = `${protocol}://${req.headers.host}/api/callback`;
    }
  }

  // 1. Ensure account user exists or import from sister tables
  let user = await findUserOrImport(accountPrimary, tables);
  if (!user) {
    user = await ensureUser(accountPrimary, tables);
  }
  const userPhone = user.phone || accountPrimary;

  // Determine if missing credentials for the active gateway
  const isTinyPesa = activeGateway === 'tinypesa';
  const missingCredentials = isTinyPesa ? !tinypesaApiKey : (!username || !password || !channelId);

  // Fallback to SIMULATED mode if explicitly requested or if credentials are missing
  if (req.body.simulated || missingCredentials) {
    console.log(`Running deposit in SIMULATED mode (Gateway: ${activeGateway}).`);

    const reference = `SIM-${appId.toUpperCase()}-${Date.now()}`;

    try {
      // Update balance directly in simulated mode
      const updateRes = await query(`
        UPDATE ${tables.users}
        SET balance = ROUND(balance + $1, 2)
        WHERE phone = $2 OR phone = $3 OR phone = $4
        RETURNING balance, phone;
      `, [depositAmount, phone254, phone0, phoneShort]);

      const newBal = updateRes.rows.length > 0 ? parseFloat(updateRes.rows[0].balance) : parseFloat(user.balance || 0) + depositAmount;

      // Log transaction with status 'Success' in DB
      await query(`
        INSERT INTO ${tables.transactions} (phone, type, amount, status, reference)
        VALUES ($1, 'Deposit', $2, 'Success', $3);
      `, [userPhone, depositAmount, reference]);

      return res.status(200).json({
        success: true,
        message: "STK push initiated successfully (SIMULATED)",
        reference: reference,
        gateway: activeGateway,
        simulated: true,
        newBalance: newBal,
        balance: newBal
      });
    } catch (dbErr) {
      console.error("Database transaction logging failed:", dbErr.message);
      return res.status(500).json({ error: 'Database transaction failed: ' + dbErr.message });
    }
  }

  // =========================================================================
  // LIVE MODE: ROUTE TO ACTIVE GATEWAY (TINYPESA OR PAYHERO)
  // =========================================================================
  const reference = `${appId.toUpperCase()}-${Date.now()}`;

  // Log pending transaction in DB
  await query(`
    INSERT INTO ${tables.transactions} (phone, type, amount, status, reference)
    VALUES ($1, 'Deposit', $2, 'PENDING', $3);
  `, [userPhone, depositAmount, reference]);

  // -------------------------------------------------------------------------
  // OPTION A: TINYPESA GATEWAY
  // -------------------------------------------------------------------------
  if (isTinyPesa) {
    try {
      const formData = new URLSearchParams();
      formData.append('amount', Math.round(depositAmount).toString());
      formData.append('msisdn', payPhone0 || payPhone254);
      formData.append('account_no', tinypesaAccountNo || reference);

      console.log(`[TinyPesa] Initiating STK push for ${payPhone0} amount ${depositAmount} (Ref: ${reference})`);

      const cleanKey = (tinypesaApiKey || '').trim();
      const response = await fetch('https://tinypesa.com/api/v1/express/initialize', {
        method: 'POST',
        headers: {
          'ApiKey': cleanKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
      });

      let data;
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }

      if (!response.ok || (data && data.success === false)) {
        await query(`
          UPDATE ${tables.transactions}
          SET status = 'FAILED'
          WHERE reference = $1;
        `, [reference]);

        console.error("TinyPesa STK push failed. Status:", response.status, "Data:", data);
        const errMsg = (data && (data.message || data.error || data.description)) || `TinyPesa API Error (${response.status})`;
        return res.status(response.status || 400).json({ error: errMsg });
      }

      return res.status(200).json({
        success: true,
        message: (data && data.message) || 'STK Push initiated successfully via TinyPesa',
        reference: reference,
        gateway: 'tinypesa',
        response: data
      });

    } catch (error) {
      await query(`
        UPDATE ${tables.transactions}
        SET status = 'FAILED'
        WHERE reference = $1;
      `, [reference]);
      console.error("TinyPesa request exception:", error);
      return res.status(500).json({ error: `TinyPesa connection error: ${error.message}` });
    }
  }

  // -------------------------------------------------------------------------
  // OPTION B: PAYHERO GATEWAY
  // -------------------------------------------------------------------------
  try {
    const payload = {
      amount: parseInt(depositAmount),
      phone_number: payPhone254,
      channel_id: parseInt(channelId),
      provider: 'm-pesa',
      external_reference: reference
    };

    if (callbackUrl) {
      payload.callback_url = callbackUrl;
    }

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
        errorMessage = "The merchant's payment service wallet has insufficient float balance. Please contact the site administrator to top up or switch to the backup gateway.";
      }

      return res.status(response.status).json({ error: errorMessage });
    }

    return res.status(200).json({
      success: true,
      message: data.message || 'STK Push initiated successfully',
      reference: reference,
      gateway: 'payhero',
      response: data
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
