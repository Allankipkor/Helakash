import { query, getTables, getAppId, normalizePhoneVariants, findUserOrImport, ensureUser } from './db.js';

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

  const cleanEnvVar = (val) => {
    if (!val) return val;
    let clean = val.trim();
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
      clean = clean.slice(1, -1);
    }
    return clean.trim();
  };

  let minDeposit = 300;
  let secretKey = cleanEnvVar(process.env.PAYSTACK_SECRET_KEY);
  let publicKey = cleanEnvVar(process.env.PAYSTACK_PUBLIC_KEY);

  try {
    const settingsQuery = await query(`SELECT * FROM ${tables.settings} WHERE id = $1;`, [appId]);
    if (settingsQuery.rows.length > 0) {
      const dbSettings = settingsQuery.rows[0];
      minDeposit = parseFloat(dbSettings.min_deposit || 300);
      if (dbSettings.paystack_secret_key) secretKey = dbSettings.paystack_secret_key;
      if (dbSettings.paystack_public_key) publicKey = dbSettings.paystack_public_key;
    }
  } catch (dbErr) {
    console.error("Error reading settings in paystack-init.js:", dbErr);
  }

  const parsedAmount = parseInt(amount);
  if (isNaN(parsedAmount) || parsedAmount < minDeposit) {
    return res.status(400).json({ error: `Minimum deposit amount is KES ${minDeposit}.` });
  }

  // Normalize phone number (account owner who gets credited)
  const targetAccountPhone = accountPhone || phone;
  const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(targetAccountPhone);

  if (!/^254[71]\d{8}$/.test(phone254)) {
    return res.status(400).json({ error: 'Invalid account phone number format.' });
  }

  const email = `${phone254}@helakash.com`;

  // Ensure user exists
  let user = await findUserOrImport(primary, tables);
  if (!user) {
    user = await ensureUser(primary, tables);
  }
  const userPhone = user.phone || primary;

  // Fallback to SIMULATED mode if secret key is missing
  if (!secretKey) {
    console.log("Paystack secret key not configured. Running in SIMULATED mode.");
    const reference = `PS-SIM-${Date.now()}`;

    try {
      // Log pending transaction in DB
      await query(`
        INSERT INTO ${tables.transactions} (phone, type, amount, status, reference, created_at)
        VALUES ($1, 'Deposit (Paystack)', $2, 'PENDING', $3, CURRENT_TIMESTAMP);
      `, [userPhone, parsedAmount, reference]);
    } catch (dbErr) {
      console.error("Database transaction logging failed (Simulated):", dbErr.message);
      return res.status(500).json({ error: 'Database logging failed' });
    }

    return res.status(200).json({
      success: true,
      reference: reference,
      simulated: true,
      email: email,
      amount: parsedAmount
    });
  }

  // Live/Test Paystack initialization
  try {
    const reference = `HK-PS-${Date.now()}`;

    // Log pending transaction in DB
    await query(`
      INSERT INTO ${tables.transactions} (phone, type, amount, status, reference, created_at)
      VALUES ($1, 'Deposit (Paystack)', $2, 'PENDING', $3, CURRENT_TIMESTAMP);
    `, [userPhone, parsedAmount, reference]);

    return res.status(200).json({
      success: true,
      reference: reference,
      simulated: false,
      key: publicKey || '',
      email: email,
      amount: parsedAmount
    });
  } catch (error) {
    console.error("Paystack deposit initialization failure:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
