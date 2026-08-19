import { sql, TABLES } from './db.js';

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
    // 1. Fetch user
    let userQuery = await sql`
      SELECT balance FROM ${TABLES.USERS} WHERE phone = ${cleanPhone};
    `;

    if (userQuery.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "User account not found."
      });
    }

    const balance = parseFloat(userQuery.rows[0].balance);

    // 2. Fetch last 20 transactions
    const txQuery = await sql`
      SELECT type, amount, status, created_at as date 
      FROM ${TABLES.TRANSACTIONS} 
      WHERE phone = ${cleanPhone} 
      ORDER BY created_at DESC, id DESC 
      LIMIT 20;
    `;

    // Map database date object to ISO format for client-side local real-time rendering
    const transactions = txQuery.rows.map(tx => {
      let isoDate = '';
      if (tx.date instanceof Date) {
        isoDate = tx.date.toISOString();
      } else if (tx.date) {
        const dt = new Date(tx.date);
        isoDate = isNaN(dt.getTime()) ? String(tx.date) : dt.toISOString();
      } else {
        isoDate = new Date().toISOString();
      }

      return {
        type: tx.type,
        amount: parseFloat(tx.amount),
        status: tx.status,
        date: isoDate
      };
    });

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
