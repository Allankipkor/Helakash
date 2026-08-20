import { query, getTables, initAppDatabase, normalizePhoneVariants, findUserOrImport, ensureUser } from './db.js';

export default async function handler(req, res) {
  const tables = getTables(req);

  // Allow GET or POST
  const rawPhone = req.query.phone || (req.body && req.body.phone);
  if (!rawPhone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(rawPhone);

  if (!/^254[71]\d{8}$/.test(phone254)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format.' });
  }

  try {
    try {
      await initAppDatabase(req);
    } catch (_) {}

    // 1. Fetch user from DB (or import from sister tables if missing)
    let user = await findUserOrImport(rawPhone, tables);
    if (!user) {
      user = await ensureUser(rawPhone, tables);
    }

    const currentBalance = parseFloat(user.balance || 0.00);
    const userPhone = user.phone || primary;

    // 2. Fetch last 25 transactions for user matching any of the 3 phone variants
    const txQuery = await query(`
      SELECT id, type, amount, status, reference, created_at 
      FROM ${tables.transactions} 
      WHERE phone = $1 OR phone = $2 OR phone = $3 
      ORDER BY created_at DESC 
      LIMIT 25;
    `, [phone254, phone0, phoneShort]);

    return res.status(200).json({
      success: true,
      phone: userPhone,
      balance: currentBalance,
      user: {
        phone: userPhone,
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
