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

  if (!/^254[71]\d{8}$/.test(phone254)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format. Please use 07XXXXXXXX or 7XXXXXXXX.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  }

  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

  try {
    // 1. Check if user already exists in current table or sister tables
    let existingUser = await findUserOrImport(phone, tables);
    if (!existingUser) {
      const checkUser = await query(`
        SELECT phone FROM ${tables.users} 
        WHERE phone = $1 OR phone = $2 OR phone = $3;
      `, [phone254, phone0, phoneShort]);

      if (checkUser.rows.length > 0) {
        existingUser = checkUser.rows[0];
      }
    }

    if (existingUser) {
      return res.status(400).json({ error: 'Phone number is already registered. Please login instead.' });
    }

    // 2. Create new user with starting balance 0.00
    await query(`
      INSERT INTO ${tables.users} (phone, password_hash, balance) 
      VALUES ($1, $2, 0.00);
    `, [primary, passwordHash]);

    return res.status(200).json({
      success: true,
      message: 'Account registered successfully',
      user: {
        phone: primary,
        balance: 0.00
      }
    });
  } catch (error) {
    console.error("Signup error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
