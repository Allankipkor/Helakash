import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { amount, phone } = req.body;
  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone number are required.' });
  }

  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  try {
    const userQuery = await sql`
      SELECT balance FROM helakash_users WHERE phone = ${cleanPhone};
    `;

    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: "User account not found." });
    }

    const currentBalance = parseFloat(userQuery.rows[0].balance);
    if (currentBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance to withdraw." });
    }

    // Deduct balance and log completed withdrawal transaction
    await sql`
      UPDATE helakash_users 
      SET balance = balance - ${amount} 
      WHERE phone = ${cleanPhone};
    `;

    const reference = `WD-${Date.now()}`;
    await sql`
      INSERT INTO helakash_transactions (phone, type, amount, status, reference)
      VALUES (${cleanPhone}, 'Withdraw', ${-amount}, 'Completed', ${reference});
    `;

    return res.status(200).json({
      success: true,
      message: "Withdrawal processed successfully",
      newBalance: currentBalance - amount
    });
  } catch (error) {
    console.error("Withdrawal error:", error);
    return res.status(500).json({ error: error.message });
  }
}
