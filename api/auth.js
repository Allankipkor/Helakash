import { sql, TABLES } from './db.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, password } = req.body;
  const action = req.query.action || req.body.action;

  if (!action || (action !== 'login' && action !== 'signup')) {
    return res.status(400).json({ error: 'Action parameter is required and must be login or signup.' });
  }

  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone number and password are required.' });
  }

  // Format phone number
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  if (!/^254[71]\d{8}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format. Please use 07XXXXXXXX or 7XXXXXXXX.' });
  }

  try {
    if (action === 'login') {
      // 1. Fetch user from DB
      const userQuery = await sql`
        SELECT phone, password_hash FROM ${TABLES.USERS} WHERE phone = ${cleanPhone};
      `;

      if (userQuery.rows.length === 0) {
        return res.status(400).json({ error: 'Phone number not registered. Please sign up.' });
      }

      const user = userQuery.rows[0];

      // Securely hash input password and compare
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      
      if (user.password_hash !== passwordHash) {
        return res.status(400).json({ error: 'Incorrect password.' });
      }

      return res.status(200).json({
        success: true,
        message: 'Login successful.'
      });
    } else {
      // 2. Signup action
      if (password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
      }

      // Check if user already exists
      const userQuery = await sql`
        SELECT phone FROM ${TABLES.USERS} WHERE phone = ${cleanPhone};
      `;

      if (userQuery.rows.length > 0) {
        return res.status(400).json({ error: 'This phone number is already registered.' });
      }

      // Securely hash password using SHA-256
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

      // Register user with a starting balance of 0.00 KES (production real money mode)
      await sql`
        INSERT INTO ${TABLES.USERS} (phone, password_hash, balance)
        VALUES (${cleanPhone}, ${passwordHash}, 0.00);
      `;

      return res.status(200).json({
        success: true,
        message: 'Account registered successfully.'
      });
    }
  } catch (error) {
    console.error(`Auth ${action} error:`, error);
    return res.status(500).json({ error: error.message });
  }
}
