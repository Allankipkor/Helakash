import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { amount, phone, accountPhone } = req.body;
  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone number are required.' });
  }

  const parsedAmount = parseInt(amount);
  if (isNaN(parsedAmount) || parsedAmount < 400) {
    return res.status(400).json({ error: 'Minimum deposit amount is KES 400.' });
  }

  // Normalize phone number (account owner who gets credited)
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

  const secretKey = cleanEnvVar(process.env.PAYSTACK_SECRET_KEY);
  const publicKey = cleanEnvVar(process.env.PAYSTACK_PUBLIC_KEY);

  const email = `${cleanAccountPhone}@helakash.com`;

  // Fallback to SIMULATED mode if secret key is missing
  if (!secretKey) {
    console.log("Paystack secret key not configured. Running in SIMULATED mode.");
    const reference = `PS-SIM-${Date.now()}`;

    try {
      // Ensure user exists in DB
      await sql`
        INSERT INTO helakash_users (phone, balance, password_hash)
        VALUES (${cleanAccountPhone}, 0.00, 'NO_PASSWORD_MIGRATED')
        ON CONFLICT (phone) DO NOTHING;
      `;

      // Log pending transaction in DB
      await sql`
        INSERT INTO helakash_transactions (phone, type, amount, status, reference)
        VALUES (${cleanAccountPhone}, 'Deposit (Paystack)', ${parsedAmount}, 'PENDING', ${reference});
      `;
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

    // Ensure user exists in DB
    await sql`
      INSERT INTO helakash_users (phone, balance, password_hash)
      VALUES (${cleanAccountPhone}, 0.00, 'NO_PASSWORD_MIGRATED')
      ON CONFLICT (phone) DO NOTHING;
    `;

    // Log pending transaction in DB
    await sql`
      INSERT INTO helakash_transactions (phone, type, amount, status, reference)
      VALUES (${cleanAccountPhone}, 'Deposit (Paystack)', ${parsedAmount}, 'PENDING', ${reference});
    `;

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
