import { query, getTables, initAppDatabase } from './db.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  const tables = getTables(req);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, password } = req.body || {};
  const action = req.query.action || (req.body && req.body.action);

  if (!action || (action !== 'login' && action !== 'signup')) {
    return res.status(400).json({ error: 'Action parameter is required and must be login or signup.' });
  }

  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone number and password are required.' });
  }

  // Format Kenyan phone number to 254XXXXXXXXX
  let cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  if (!/^254[71]\d{8}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format. Please use 07XXXXXXXX or 7XXXXXXXX.' });
  }

  // Ensure DB tables exist for this app
  try {
    await initAppDatabase(req);
  } catch (initErr) {
    console.warn("initAppDatabase non-fatal notice in auth.js:", initErr.message);
  }

  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

  try {
    if (action === 'login') {
      // 1. Fetch user from DB
      const userQuery = await query(`
        SELECT phone, password_hash, balance 
        FROM ${tables.users} 
        WHERE phone = $1;
      `, [cleanPhone]);

      if (userQuery.rows.length === 0) {
        return res.status(400).json({ error: 'Phone number not registered. Please sign up.' });
      }

      const user = userQuery.rows[0];

      // Compare SHA-256 hash or plaintext fallback for legacy records
      const isMatch = (user.password_hash === passwordHash) || 
                      (user.password_hash === password) || 
                      (user.password_hash === 'NO_PASSWORD_MIGRATED');

      if (!isMatch) {
        return res.status(400).json({ error: 'Incorrect password. Please try again.' });
      }

      // If user had plain text password, migrate to hash
      if (user.password_hash === password) {
        try {
          await query(`UPDATE ${tables.users} SET password_hash = $1 WHERE phone = $2;`, [passwordHash, cleanPhone]);
        } catch (_) {}
      }

      return res.status(200).json({
        success: true,
        message: 'Login successful.',
        user: {
          phone: user.phone,
          balance: parseFloat(user.balance || 0)
        }
      });
    } else {
      // 2. Signup action
      if (password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
      }

      // Check if user already exists
      const userQuery = await query(`
        SELECT phone FROM ${tables.users} 
        WHERE phone = $1;
      `, [cleanPhone]);

      if (userQuery.rows.length > 0) {
        return res.status(400).json({ error: 'This phone number is already registered. Please sign in.' });
      }

      // Register user with a starting balance of 0.00 KES
      await query(`
        INSERT INTO ${tables.users} (phone, password_hash, balance)
        VALUES ($1, $2, 0.00);
      `, [cleanPhone, passwordHash]);

      return res.status(200).json({
        success: true,
        message: 'Account registered successfully.',
        user: {
          phone: cleanPhone,
          balance: 0.00
        }
      });
    }
  } catch (error) {
    console.error(`Auth ${action} error:`, error.message);
    return res.status(500).json({ error: error.message });
  }
}
