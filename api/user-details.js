import { query, getTables, initAppDatabase } from './db.js';

export default async function handler(req, res) {
  const tables = getTables(req);

  // Allow GET or POST
  const phone = req.query.phone || (req.body && req.body.phone);
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  let cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  if (!/^254[71]\d{8}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format.' });
  }

  try {
    try {
      await initAppDatabase(req);
    } catch (_) {}

    // 1. Fetch user from DB
    let userQuery = await query(`
      SELECT phone, balance, created_at FROM ${tables.users} 
      WHERE phone = $1;
    `, [cleanPhone]);

    if (userQuery.rows.length === 0) {
      // Auto-provision user record if first-time query
      await query(`
        INSERT INTO ${tables.users} (phone, balance, password_hash)
        VALUES ($1, 0.00, 'NO_PASSWORD_MIGRATED')
        ON CONFLICT (phone) DO NOTHING;
      `, [cleanPhone]);

      userQuery = await query(`
        SELECT phone, balance, created_at FROM ${tables.users} 
        WHERE phone = $1;
      `, [cleanPhone]);
    }

    const user = userQuery.rows[0] || { phone: cleanPhone, balance: 0.00, created_at: new Date() };
    const currentBalance = parseFloat(user.balance || 0.00);

    // 2. Fetch last 25 transactions for user
    const txQuery = await query(`
      SELECT id, type, amount, status, reference, created_at FROM ${tables.transactions} 
      WHERE phone = $1 
      ORDER BY created_at DESC 
      LIMIT 25;
    `, [cleanPhone]);

    return res.status(200).json({
      success: true,
      phone: user.phone,
      balance: currentBalance,
      user: {
        phone: user.phone,
        balance: currentBalance,
        created_at: user.created_at
      },
      transactions: txQuery.rows.map(tx => ({
        id: tx.id,
        type: tx.type,
        amount: parseFloat(tx.amount),
        status: tx.status,
        reference: tx.reference,
        created_at: tx.created_at,
        date: tx.created_at
      }))
    });
  } catch (error) {
    console.error("user-details error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
