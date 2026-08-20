import { query, getAppId, getTables } from './db.js';

export default async function handler(req, res) {
  const tables = getTables(req);
  const appId = getAppId(req);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, amount } = req.body;
  const withdrawAmount = parseFloat(amount);

  let minWithdrawal = 500.00;
  try {
    let settingsQuery = await query(`SELECT min_withdrawal FROM ${tables.settings} WHERE id = $1;`, [appId]);
    if (settingsQuery.rows.length === 0) {
      settingsQuery = await query(`SELECT min_withdrawal FROM ${tables.settings} LIMIT 1;`);
    }
    if (settingsQuery.rows.length > 0) {
      minWithdrawal = parseFloat(settingsQuery.rows[0].min_withdrawal || 500.00);
    }
  } catch (dbErr) {
    console.error("Failed to fetch min_withdrawal setting from DB:", dbErr.message);
  }

  if (!phone || isNaN(withdrawAmount) || withdrawAmount < minWithdrawal) {
    return res.status(400).json({ error: `Invalid amount. Minimum withdrawal is KES ${minWithdrawal}.` });
  }

  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  try {
    // 1. Fetch user to verify balance in DB
    const userQuery = await query(`
      SELECT balance FROM ${tables.users} 
      WHERE phone = $1;
    `, [cleanPhone]);

    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    const currentBalance = parseFloat(userQuery.rows[0].balance);
    if (currentBalance < withdrawAmount) {
      return res.status(400).json({ error: 'Insufficient balance.' });
    }

    // 2. Deduct user balance
    const updatedUser = await query(`
      UPDATE ${tables.users} 
      SET balance = balance - $1 
      WHERE phone = $2 
      RETURNING balance;
    `, [withdrawAmount, cleanPhone]);

    // 3. Record pending transaction in DB
    const reference = `WD-${appId.toUpperCase()}-${Date.now()}`;
    await query(`
      INSERT INTO ${tables.transactions} (phone, type, amount, status, reference)
      VALUES ($1, 'Withdrawal', $2, 'Pending', $3);
    `, [cleanPhone, withdrawAmount, reference]);

    return res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      newBalance: parseFloat(updatedUser.rows[0].balance),
      reference: reference
    });
  } catch (error) {
    console.error("Withdrawal error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
