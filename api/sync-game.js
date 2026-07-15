import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, type, amount } = req.body;
  if (!phone || !type || amount === undefined) {
    return res.status(400).json({ error: 'Phone, type, and amount are required.' });
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
    const newBalance = currentBalance + parseFloat(amount);

    if (newBalance < 0) {
      return res.status(400).json({ error: "Insufficient balance." });
    }

    // Update user balance
    await sql`
      UPDATE helakash_users 
      SET balance = ${newBalance} 
      WHERE phone = ${cleanPhone};
    `;

    // Log game transaction
    const reference = `GM-${Date.now()}`;
    await sql`
      INSERT INTO helakash_transactions (phone, type, amount, status, reference)
      VALUES (${cleanPhone}, ${type}, ${amount}, 'Success', ${reference});
    `;

    return res.status(200).json({
      success: true,
      newBalance: newBalance
    });
  } catch (error) {
    console.error("Game sync error:", error);
    return res.status(500).json({ error: error.message });
  }
}
