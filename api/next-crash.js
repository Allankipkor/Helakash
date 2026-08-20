import { query, getAppId, getTables } from './db.js';

export default async function handler(req, res) {
  const appId = getAppId(req);
  const tables = getTables(req);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone } = req.query;

  // Clean phone number format
  let cleanPhone = phone ? phone.replace(/\D/g, '') : null;
  if (cleanPhone) {
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '254' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
      cleanPhone = '254' + cleanPhone;
    }
  }

  try {
    // Check active round for this app
    let result = await query(`
      SELECT crash_point, crash_point_2, crash_point_3 FROM ${tables.active_rounds} WHERE phone = $1;
    `, [appId]);

    if (result.rows.length === 0) {
      result = await query(`
        SELECT crash_point, crash_point_2, crash_point_3 FROM ${tables.active_rounds} LIMIT 1;
      `);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active round found for this session.' });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      app_id: appId,
      crash_point: parseFloat(row.crash_point),
      crash_point_2: parseFloat(row.crash_point_2),
      crash_point_3: parseFloat(row.crash_point_3)
    });
  } catch (error) {
    console.error("next-crash error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
