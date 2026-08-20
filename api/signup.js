import { query, getTables } from './db.js';

export default async function handler(req, res) {
  const tables = getTables(req);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone number and password are required.' });
  }

  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  if (!/^254[71]\d{8}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format. Please use 07XXXXXXXX or 7XXXXXXXX.' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  }

  try {
    // 1. Check if user already exists
    const checkUser = await query(`
      SELECT phone FROM ${tables.users} 
      WHERE phone = $1;
    `, [cleanPhone]);

    if (checkUser.rows.length > 0) {
      return res.status(400).json({ error: 'Phone number is already registered. Please login instead.' });
    }

    // 2. Create new user with starting balance 0.00
    await query(`
      INSERT INTO ${tables.users} (phone, password_hash, balance) 
      VALUES ($1, $2, 0.00);
    `, [cleanPhone, password]);

    return res.status(200).json({
      success: true,
      message: 'Account registered successfully',
      user: {
        phone: cleanPhone,
        balance: 0.00
      }
    });
  } catch (error) {
    console.error("Signup error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
