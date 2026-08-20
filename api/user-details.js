import { query, getTables } from './db.js';

export default async function handler(req, res) {
  const tables = getTables(req);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone } = req.query;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  try {
    // 1. Fetch user from DB
    const userQuery = await query(`
      SELECT phone, balance, created_at FROM ${tables.users} 
      WHERE phone = $1;
    `, [cleanPhone]);

    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: 'User not found in database.' });
    }

    const user = userQuery.rows[0];

    // 2. Fetch last 20 transactions for user
    const txQuery = await query(`
      SELECT id, type, amount, status, reference, created_at FROM ${tables.transactions} 
      WHERE phone = $1 
      ORDER BY created_at DESC 
      LIMIT 20;
    `, [cleanPhone]);

    return res.status(200).json({
      success: true,
      user: {
        phone: user.phone,
        balance: parseFloat(user.balance),
        created_at: user.created_at
      },
      transactions: txQuery.rows.map(tx => ({
        id: tx.id,
        type: tx.type,
        amount: parseFloat(tx.amount),
        status: tx.status,
        reference: tx.reference,
        created_at: tx.created_at
      }))
    });
  } catch (error) {
    console.error("user-details error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
