import { query, getAppId, getTables, normalizePhoneVariants, findUserOrImport } from './db.js';

export default async function handler(req, res) {
  const tables = getTables(req);
  const appId = getAppId(req);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, amount } = req.body || {};
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

  const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(phone);

  try {
    // 1. Fetch user to verify balance in DB (local + sister tables)
    let user = await findUserOrImport(phone, tables);
    if (!user) {
      const userRes = await query(`
        SELECT phone, balance FROM ${tables.users}
        WHERE phone = $1 OR phone = $2 OR phone = $3
        LIMIT 1;
      `, [phone254, phone0, phoneShort]);

      if (userRes.rows.length > 0) {
        user = userRes.rows[0];
      }
    }

    if (!user) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    const currentBalance = parseFloat(user.balance || 0);
    if (currentBalance < withdrawAmount) {
      return res.status(400).json({ error: 'Insufficient balance.' });
    }

    // 2. Deduct user balance
    const updatedUser = await query(`
      UPDATE ${tables.users} 
      SET balance = ROUND(balance - $1, 2) 
      WHERE phone = $2 OR phone = $3 OR phone = $4 
      RETURNING balance, phone;
    `, [withdrawAmount, phone254, phone0, phoneShort]);

    if (updatedUser.rows.length === 0) {
      return res.status(500).json({ error: 'Failed to update balance.' });
    }

    const newBal = parseFloat(updatedUser.rows[0].balance);
    const userPhone = updatedUser.rows[0].phone || user.phone || primary;

    // 3. Record pending transaction in DB
    const reference = `WD-${appId.toUpperCase()}-${Date.now()}`;
    await query(`
      INSERT INTO ${tables.transactions} (phone, type, amount, status, reference)
      VALUES ($1, 'Withdrawal', $2, 'Pending', $3);
    `, [userPhone, withdrawAmount, reference]);

    return res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      newBalance: newBal,
      balance: newBal,
      reference: reference
    });
  } catch (error) {
    console.error("Withdrawal error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
