import { query, APP_ID, TABLES } from './db.js';

export default async function handler(req, res) {
  // 1. GET Request
  if (req.method === 'GET') {
    const { passcode } = req.query;

    try {
      // Fetch settings strictly for this specific app
      let settingsQuery = await query(`
        SELECT * FROM ${TABLES.settings} WHERE id = $1;
      `, [APP_ID]);

      if (settingsQuery.rows.length === 0) {
        // Fallback default if not seeded yet
        return res.status(200).json({
          authenticated: false,
          app_id: APP_ID,
          min_deposit: 300.00,
          min_withdrawal: 500.00,
          min_stake: 400.00
        });
      }

      const dbSettings = settingsQuery.rows[0];

      // If correct passcode is supplied, return full credentials, predictor, and successful deposits
      if (passcode && passcode === dbSettings.admin_passcode) {
        // Fetch active round crash points for this app
        let activeRoundQuery = await query(`
          SELECT crash_point, crash_point_2, crash_point_3 FROM ${TABLES.active_rounds} WHERE phone = $1;
        `, [APP_ID]);

        const activeRound = activeRoundQuery.rows[0] || { crash_point: 1.50, crash_point_2: 2.20, crash_point_3: 1.30 };

        // Fetch last 50 successful deposits from this app's transactions
        const depositsQuery = await query(`
          SELECT phone, amount, reference, created_at FROM ${TABLES.transactions}
          WHERE (LOWER(type) = 'deposit' OR LOWER(type) = 'mpesa deposit') AND LOWER(status) = 'success'
          ORDER BY created_at DESC
          LIMIT 50;
        `);

        return res.status(200).json({
          authenticated: true,
          app_id: APP_ID,
          settings: {
            min_deposit: parseFloat(dbSettings.min_deposit || 300.00),
            min_withdrawal: parseFloat(dbSettings.min_withdrawal || 500.00),
            min_stake: parseFloat(dbSettings.min_stake || 400.00),
            payhero_username: dbSettings.payhero_username || '',
            payhero_password: dbSettings.payhero_password || '',
            payhero_channel_id: dbSettings.payhero_channel_id || '',
            payhero_callback_url: dbSettings.payhero_callback_url || '',
            admin_passcode: dbSettings.admin_passcode
          },
          predictor: {
            crash_point: parseFloat(activeRound.crash_point),
            crash_point_2: parseFloat(activeRound.crash_point_2),
            crash_point_3: parseFloat(activeRound.crash_point_3)
          },
          deposits: depositsQuery.rows.map(row => ({
            phone: row.phone,
            amount: parseFloat(row.amount),
            reference: row.reference,
            created_at: row.created_at
          }))
        });
      }

      // No passcode or wrong passcode — return only public limits
      return res.status(200).json({
        authenticated: false,
        app_id: APP_ID,
        min_deposit: parseFloat(dbSettings.min_deposit || 300.00),
        min_withdrawal: parseFloat(dbSettings.min_withdrawal || 500.00),
        min_stake: parseFloat(dbSettings.min_stake || 400.00)
      });

    } catch (err) {
      console.error("GET settings error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. POST Request
  if (req.method === 'POST') {
    const {
      passcode,
      min_deposit,
      min_withdrawal,
      min_stake,
      payhero_username,
      payhero_password,
      payhero_channel_id,
      payhero_callback_url,
      new_passcode,
      crash_point,
      crash_point_2,
      crash_point_3
    } = req.body;

    if (!passcode) {
      return res.status(403).json({ error: 'Authentication required. Admin passcode is missing.' });
    }

    try {
      // Validate active passcode from DB
      let settingsQuery = await query(`
        SELECT admin_passcode FROM ${TABLES.settings} WHERE id = $1;
      `, [APP_ID]);

      if (settingsQuery.rows.length === 0) {
        return res.status(500).json({ error: `Settings row not found for ${APP_ID}. Please initialize DB.` });
      }

      const activePasscode = settingsQuery.rows[0].admin_passcode;
      if (passcode !== activePasscode) {
        return res.status(403).json({ error: 'Invalid admin passcode.' });
      }

      // Perform updates if provided
      if (min_deposit !== undefined || min_withdrawal !== undefined || min_stake !== undefined || payhero_username !== undefined || new_passcode !== undefined || payhero_callback_url !== undefined) {
        const updatePasscode = new_passcode || activePasscode;
        
        // Ensure row exists for APP_ID
        await query(`
          INSERT INTO ${TABLES.settings} (id, min_deposit, min_withdrawal, min_stake, admin_passcode)
          VALUES ($1, 300.00, 500.00, 400.00, $2)
          ON CONFLICT (id) DO NOTHING;
        `, [APP_ID, updatePasscode]);

        await query(`
          UPDATE ${TABLES.settings}
          SET min_deposit = COALESCE($1, min_deposit),
              min_withdrawal = COALESCE($2, min_withdrawal),
              min_stake = COALESCE($3, min_stake),
              payhero_username = COALESCE($4, payhero_username),
              payhero_password = COALESCE($5, payhero_password),
              payhero_channel_id = COALESCE($6, payhero_channel_id),
              payhero_callback_url = COALESCE($7, payhero_callback_url),
              admin_passcode = $8
          WHERE id = $9;
        `, [
          min_deposit !== undefined ? parseFloat(min_deposit) : null,
          min_withdrawal !== undefined ? parseFloat(min_withdrawal) : null,
          min_stake !== undefined ? parseFloat(min_stake) : null,
          payhero_username !== undefined ? payhero_username : null,
          payhero_password !== undefined ? payhero_password : null,
          payhero_channel_id !== undefined ? payhero_channel_id : null,
          payhero_callback_url !== undefined ? payhero_callback_url : null,
          updatePasscode,
          APP_ID
        ]);
      }

      // Handle predictor outcome overrides
      if (crash_point !== undefined || crash_point_2 !== undefined || crash_point_3 !== undefined) {
        const cp1 = crash_point !== undefined ? parseFloat(crash_point) : null;
        const cp2 = crash_point_2 !== undefined ? parseFloat(crash_point_2) : null;
        const cp3 = crash_point_3 !== undefined ? parseFloat(crash_point_3) : null;

        await query(`
          INSERT INTO ${TABLES.active_rounds} (phone, crash_point, crash_point_2, crash_point_3, status, created_at)
          VALUES ($1, COALESCE($2, 1.50), COALESCE($3, 2.20), COALESCE($4, 1.30), 'ACTIVE', NOW())
          ON CONFLICT (phone) DO UPDATE
          SET crash_point = COALESCE($2, ${TABLES.active_rounds}.crash_point),
              crash_point_2 = COALESCE($3, ${TABLES.active_rounds}.crash_point_2),
              crash_point_3 = COALESCE($4, ${TABLES.active_rounds}.crash_point_3),
              status = 'ACTIVE',
              created_at = NOW();
        `, [APP_ID, cp1, cp2, cp3]);
      }

      return res.status(200).json({ success: true, message: `Settings for '${APP_ID}' updated successfully.` });

    } catch (err) {
      console.error("POST settings error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
