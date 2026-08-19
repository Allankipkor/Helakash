import { query, APP_ID, TABLES } from './db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { amount, phone } = req.body;
  if (!amount || !phone) {
    return res.status(400).json({ error: 'Amount and phone number are required.' });
  }

  let minWithdrawal = 500.00;
  try {
    let settingsQuery = await query(`SELECT min_withdrawal FROM ${TABLES.settings} WHERE id = $1;`, [APP_ID]);
    if (settingsQuery.rows.length > 0) {
      minWithdrawal = parseFloat(settingsQuery.rows[0].min_withdrawal || 500.00);
    }
  } catch (dbErr) {
    console.error("Failed to fetch settings from DB in withdraw.js:", dbErr.message);
  }

  if (parseFloat(amount) < minWithdrawal) {
    return res.status(400).json({ error: `Minimum withdrawal amount is KES ${minWithdrawal}.` });
  }

  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  if (!/^254[71]\d{8}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format. Please use 07XXXXXXXX or 7XXXXXXXX.' });
  }

  try {
    const userQuery = await query(`
      SELECT balance FROM ${TABLES.users} WHERE phone = $1;
    `, [cleanPhone]);

    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: "User account not found." });
    }

    const currentBalance = parseFloat(userQuery.rows[0].balance);
    if (currentBalance < parseFloat(amount)) {
      return res.status(400).json({ error: "Insufficient balance to withdraw." });
    }

    // Deduct balance and log completed withdrawal transaction
    await query(`
      UPDATE ${TABLES.users} 
      SET balance = balance - $1 
      WHERE phone = $2;
    `, [parseFloat(amount), cleanPhone]);

    const reference = `WD-${Date.now()}`;
    await query(`
      INSERT INTO ${TABLES.transactions} (phone, type, amount, status, reference)
      VALUES ($1, 'Withdraw', $2, 'Completed', $3);
    `, [cleanPhone, -parseFloat(amount), reference]);

    return res.status(200).json({
      success: true,
      message: "Withdrawal processed successfully",
      newBalance: currentBalance - parseFloat(amount)
    });
  } catch (error) {
    console.error("Withdrawal error:", error);
    return res.status(500).json({ error: error.message });
  }
}
