import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, password } = req.body;
  
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

  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
  }

  try {
    // Check if user already exists
    const userQuery = await sql`
      SELECT phone FROM helakash_users WHERE phone = ${cleanPhone};
    `;

    if (userQuery.rows.length > 0) {
      return res.status(400).json({ error: 'This phone number is already registered.' });
    }

    // Securely hash password using SHA-256
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

    // Register user with a starting balance of 0.00 KES (production real money mode)
    await sql`
      INSERT INTO helakash_users (phone, password_hash, balance)
      VALUES (${cleanPhone}, ${passwordHash}, 0.00);
    `;

    return res.status(200).json({
      success: true,
      message: 'Account registered successfully.'
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: error.message });
  }
}
