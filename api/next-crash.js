import { query, getAppId, getTables, getOrAdvanceGlobalActiveRound } from './db.js';

export default async function handler(req, res) {
  const appId = getAppId(req);
  const tables = getTables(req);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { passcode } = req.query;

  try {
    let settingsQuery = await query(`SELECT admin_passcode FROM ${tables.settings} WHERE id = $1;`, [appId]);
    if (settingsQuery.rows.length === 0) {
      settingsQuery = await query(`SELECT admin_passcode FROM ${tables.settings} LIMIT 1;`);
    }

    const activePasscode = (settingsQuery.rows[0]?.admin_passcode || process.env.ADMIN_PASSCODE || '').toString().trim();
    const inputPasscode = (passcode || '').toString().trim();

    if (!activePasscode || inputPasscode !== activePasscode) {
      return res.status(401).json({ error: 'Unauthorized. Admin passcode required to view crash predictions.' });
    }

    const roundState = await getOrAdvanceGlobalActiveRound(appId, tables);

    return res.status(200).json({
      success: true,
      app_id: appId,
      crash_point: roundState.crashPoint,
      crash_point_2: roundState.crashPoint2,
      crash_point_3: roundState.crashPoint3,
      phase: roundState.phase,
      remaining_ms: roundState.remainingMs,
      current_multiplier: roundState.currentMultiplier,
      speed: roundState.speedSetting,
      speed_params: roundState.speedParams
    });
  } catch (error) {
    console.error("next-crash error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
