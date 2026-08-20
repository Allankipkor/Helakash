import { query, getTables, normalizePhoneVariants, findUserOrImport } from './db.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  const tables = getTables(req);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, password } = req.body || {};
  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone number and password are required.' });
  }

  const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(phone);

  try {
    // 1. Fetch user from DB (checking current table and sister tables)
    let user = await findUserOrImport(phone, tables);
    if (!user) {
      const userQuery = await query(`
        SELECT phone, password_hash, balance 
        FROM ${tables.users} 
        WHERE phone = $1 OR phone = $2 OR phone = $3
        LIMIT 1;
      `, [phone254, phone0, phoneShort]);

      if (userQuery.rows.length > 0) {
        user = userQuery.rows[0];
      }
    }

    if (!user) {
      return res.status(404).json({ error: 'Account not found. Please create an account first.' });
    }

    // 2. Validate password
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const isMatch = (user.password_hash === passwordHash) || 
                    (user.password_hash === password) || 
                    (user.password_hash === 'NO_PASSWORD_MIGRATED');

    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        phone: user.phone || primary,
        balance: parseFloat(user.balance || 0.00)
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
