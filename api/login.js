import { query, getTables, initAppDatabase } from './db.js';
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

  let cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  if (!/^254[71]\d{8}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format. Please use 07XXXXXXXX or 7XXXXXXXX.' });
  }

  try {
    await initAppDatabase(req);
  } catch (initErr) {
    console.warn("initAppDatabase non-fatal notice in login.js:", initErr.message);
  }

  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

  try {
    // 1. Fetch user from DB
    const userQuery = await query(`
      SELECT phone, password_hash, balance 
      FROM ${tables.users} 
      WHERE phone = $1;
    `, [cleanPhone]);

    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found. Please create an account first.' });
    }

    const user = userQuery.rows[0];

    // 2. Validate password
    const isMatch = (user.password_hash === passwordHash) || 
                    (user.password_hash === password) || 
                    (user.password_hash === 'NO_PASSWORD_MIGRATED');

    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    if (user.password_hash === password) {
      try {
        await query(`UPDATE ${tables.users} SET password_hash = $1 WHERE phone = $2;`, [passwordHash, cleanPhone]);
      } catch (_) {}
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        phone: user.phone,
        balance: parseFloat(user.balance || 0)
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
