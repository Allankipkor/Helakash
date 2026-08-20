import { query, getTables, initAppDatabase, normalizePhoneVariants, findUserOrImport } from './db.js';
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

  const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(phone);

  if (!/^254[71]\d{8}$/.test(phone254)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format. Please use 07XXXXXXXX or 7XXXXXXXX.' });
  }

  // Ensure DB tables exist for this app
  try {
    await initAppDatabase(req);
  } catch (initErr) {
    console.warn("initAppDatabase notice in auth.js:", initErr.message);
  }

  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

  try {
    if (action === 'login') {
      // 1. Fetch user from DB (local table or sister tables)
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
        return res.status(400).json({ error: 'Phone number not registered. Please sign up.' });
      }

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
          await query(`UPDATE ${tables.users} SET password_hash = $1 WHERE phone = $2 OR phone = $3 OR phone = $4;`, [passwordHash, phone254, phone0, phoneShort]);
        } catch (_) {}
      }

      return res.status(200).json({
        success: true,
        message: 'Login successful.',
        user: {
          phone: user.phone || primary,
          balance: parseFloat(user.balance || 0.00)
        }
      });
    } else {
      // 2. Signup action
      if (password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
      }

      // Check if user already exists
      let existingUser = await findUserOrImport(phone, tables);
      if (!existingUser) {
        const userQuery = await query(`
          SELECT phone FROM ${tables.users} 
          WHERE phone = $1 OR phone = $2 OR phone = $3
          LIMIT 1;
        `, [phone254, phone0, phoneShort]);

        if (userQuery.rows.length > 0) {
          existingUser = userQuery.rows[0];
        }
      }

      if (existingUser) {
        return res.status(400).json({ error: 'This phone number is already registered. Please sign in.' });
      }

      // Register user with starting balance of 0.00 KES
      await query(`
        INSERT INTO ${tables.users} (phone, password_hash, balance)
        VALUES ($1, $2, 0.00);
      `, [primary, passwordHash]);

      return res.status(200).json({
        success: true,
        message: 'Account registered successfully.',
        user: {
          phone: primary,
          balance: 0.00
        }
      });
    }
  } catch (error) {
    console.error(`Auth ${action} error:`, error.message);
    return res.status(500).json({ error: error.message });
  }
}
