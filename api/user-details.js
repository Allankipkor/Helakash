import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export default async function handler(req, res) {
  // Allow GET or POST
  const phone = req.query.phone || (req.body && req.body.phone);
  
  if (!phone) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  // Clean phone number
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  try {
    // 1. Fetch or create user
    let userQuery = await sql`
      SELECT balance FROM helakash_users WHERE phone = ${cleanPhone};
    `;

    if (userQuery.rows.length === 0) {
      // Create user with starting balance of 0 KES (production real money mode)
      await sql`
        INSERT INTO helakash_users (phone, balance, password_hash) 
        VALUES (${cleanPhone}, 0.00, 'NO_PASSWORD_MIGRATED');
      `;
      userQuery = await sql`
        SELECT balance FROM helakash_users WHERE phone = ${cleanPhone};
      `;
    }

    const balance = parseFloat(userQuery.rows[0].balance);

    // 2. Fetch last 20 transactions
    const txQuery = await sql`
      SELECT type, amount, status, created_at as date 
      FROM helakash_transactions 
      WHERE phone = ${cleanPhone} 
      ORDER BY created_at DESC 
      LIMIT 20;
    `;

    // Map database date object to local date string format matching client UI expectations
    const transactions = txQuery.rows.map(tx => ({
      type: tx.type,
      amount: parseFloat(tx.amount),
      status: tx.status,
      date: new Date(tx.date).toLocaleString()
    }));

    return res.status(200).json({
      success: true,
      phone: cleanPhone,
      balance: balance,
      transactions: transactions
    });
  } catch (error) {
    console.error("User details fetch error:", error);
    return res.status(500).json({ error: error.message });
  }
}
