import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { amount, phone } = req.body;
  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone number are required.' });
  }

  // Clean phone number (strip leading +, spaces, etc.)
  let cleanPhone = phone.replace(/\D/g, '');
  // Format standard Kenyan mobile numbers: e.g. 0712345678 -> 254712345678
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  const username = process.env.PAYHERO_USERNAME;
  const password = process.env.PAYHERO_PASSWORD;
  const channelId = process.env.PAYHERO_CHANNEL_ID;
  const callbackUrl = process.env.PAYHERO_CALLBACK_URL;

  // Fallback to SIMULATED mode if credentials are missing
  if (!username || !password || !channelId) {
    console.log("Pay Hero API credentials not configured. Running in SIMULATED mode.");
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    const reference = `SIM-HK-${Date.now()}`;

    try {
      // Ensure user exists in DB
      await sql`
        INSERT INTO helakash_users (phone, balance, password_hash)
        VALUES (${cleanPhone}, 0.00, 'NO_PASSWORD_MIGRATED')
        ON CONFLICT (phone) DO NOTHING;
      `;
      // Log transaction in DB
      await sql`
        INSERT INTO helakash_transactions (phone, type, amount, status, reference)
        VALUES (${cleanPhone}, 'Deposit', ${amount}, 'PENDING', ${reference});
      `;
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
    const reference = `HK-${Date.now()}`;
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
    await sql`
      INSERT INTO helakash_users (phone, balance, password_hash)
      VALUES (${cleanPhone}, 0.00, 'NO_PASSWORD_MIGRATED')
      ON CONFLICT (phone) DO NOTHING;
    `;
    // Log pending transaction in DB
    await sql`
      INSERT INTO helakash_transactions (phone, type, amount, status, reference)
      VALUES (${cleanPhone}, 'Deposit', ${amount}, 'PENDING', ${reference});
    `;

    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    const response = await fetch('https://backend.payhero.co.ke/api/v2/payments/initiate-stk-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      // Mark transaction as failed in DB
      await sql`
        UPDATE helakash_transactions 
        SET status = 'FAILED' 
        WHERE reference = ${reference};
      `;
      return res.status(response.status).json({ error: data.message || 'Pay Hero API Error' });
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
