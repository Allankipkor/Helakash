import { query, TABLES } from './db.js';

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
    // 1. Fetch user from this site's user table
    const userQuery = await query(`
      SELECT balance FROM ${TABLES.users} WHERE phone = $1;
    `, [cleanPhone]);

    if (userQuery.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User details not found or session invalid.' });
    }

    const balance = parseFloat(userQuery.rows[0].balance);

    // 2. Fetch last 20 transactions from this site's transactions table
    const txQuery = await query(`
      SELECT type, amount, status, created_at as date 
      FROM ${TABLES.transactions} 
      WHERE phone = $1 
      ORDER BY created_at DESC 
      LIMIT 20;
    `, [cleanPhone]);

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
