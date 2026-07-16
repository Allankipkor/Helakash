import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone } = req.query;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  // Normalise phone number format
  let cleanPhone = phone;
  if (!phone.startsWith('guest_')) {
    cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '254' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
      cleanPhone = '254' + cleanPhone;
    }
  }

  try {
    const result = await sql`
      SELECT crash_point, crash_point_2, crash_point_3 FROM helakash_active_rounds WHERE phone = 'global';
    `;

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active round found for this session.' });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      phone: cleanPhone,
      crash_point: parseFloat(row.crash_point),
      crash_point_2: parseFloat(row.crash_point_2),
      crash_point_3: parseFloat(row.crash_point_3)
    });
  } catch (error) {
    console.error("Error fetching next crash:", error);
    return res.status(500).json({ error: error.message });
  }
}
