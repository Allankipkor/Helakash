import { query, getAppId, getTables, initAppDatabase, normalizePhoneVariants, findUserOrImport, ensureUser, getOrAdvanceGlobalActiveRound } from './db.js';

export default async function handler(req, res) {
  const appId = getAppId(req);
  const tables = getTables(req);

  // 1. GET Request
  if (req.method === 'GET') {
    const { passcode, from, to, search, limit, user_search } = req.query;

    try {
      // Ensure database tables exist for this tenant
      try {
        await initAppDatabase(req);
      } catch (_) {}

      // Fetch settings strictly for this specific app
      let settingsQuery = await query(`
        SELECT * FROM ${tables.settings} WHERE id = $1;
      `, [appId]);

      if (settingsQuery.rows.length === 0) {
        settingsQuery = await query(`SELECT * FROM ${tables.settings} LIMIT 1;`);
      }

      if (settingsQuery.rows.length === 0) {
        // Fallback default if not seeded yet
        return res.status(200).json({
          success: true,
          authenticated: false,
          app_id: appId,
          min_deposit: 300.00,
          min_withdrawal: 500.00,
          min_stake: 400.00,
          aviator_speed: 'normal'
        });
      }

      const dbSettings = settingsQuery.rows[0];
      const dbPasscode = (dbSettings.admin_passcode || '').toString().trim();
      const inputPasscode = (passcode || '').toString().trim();

      // If correct passcode is supplied, return full credentials, predictor, deposits with stats, and users directory
      if (inputPasscode && inputPasscode === dbPasscode) {
        // Fetch active round crash points using global engine
        const activeRound = await getOrAdvanceGlobalActiveRound(appId, tables);

        // 1. Build dynamic filter for successful deposits
        let depositWhere = `(LOWER(type) = 'deposit' OR LOWER(type) = 'mpesa deposit' OR LOWER(type) = 'admin deposit' OR LOWER(type) LIKE '%deposit%') AND LOWER(status) = 'success'`;
        const depositParams = [];
        let pIdx = 1;

        if (from && from.trim()) {
          depositWhere += ` AND created_at >= $${pIdx++}`;
          depositParams.push(new Date(from.trim()).toISOString());
        }

        if (to && to.trim()) {
          depositWhere += ` AND created_at <= $${pIdx++}`;
          depositParams.push(new Date(to.trim()).toISOString());
        }

        if (search && search.trim()) {
          depositWhere += ` AND (phone ILIKE $${pIdx} OR reference ILIKE $${pIdx})`;
          depositParams.push(`%${search.trim()}%`);
          pIdx++;
        }

        const maxLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
        const depositsQueryText = `
          SELECT phone, amount, reference, created_at 
          FROM ${tables.transactions}
          WHERE ${depositWhere}
          ORDER BY created_at DESC
          LIMIT ${maxLimit};
        `;
        const depositsQuery = await query(depositsQueryText, depositParams);

        // 2. Dynamic Volume Summary Badges: Filtered Total & Count
        const statsQueryText = `
          SELECT 
            COALESCE(SUM(amount), 0) AS filtered_total,
            COUNT(*) AS filtered_count
          FROM ${tables.transactions}
          WHERE ${depositWhere};
        `;
        const statsQuery = await query(statsQueryText, depositParams);
        const filteredTotal = parseFloat(statsQuery.rows[0]?.filtered_total || 0);
        const filteredCount = parseInt(statsQuery.rows[0]?.filtered_count || 0);

        // 3. Dynamic Volume Summary Badges: Today's Total Volume & Count (Nairobi timezone / current date)
        let todayStatsQuery;
        try {
          todayStatsQuery = await query(`
            SELECT 
              COALESCE(SUM(amount), 0) AS today_total,
              COUNT(*) AS today_count
            FROM ${tables.transactions}
            WHERE (LOWER(type) = 'deposit' OR LOWER(type) = 'mpesa deposit' OR LOWER(type) = 'admin deposit' OR LOWER(type) LIKE '%deposit%')
              AND LOWER(status) = 'success'
              AND created_at >= (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Nairobi')::date;
          `);
        } catch (_) {
          todayStatsQuery = await query(`
            SELECT 
              COALESCE(SUM(amount), 0) AS today_total,
              COUNT(*) AS today_count
            FROM ${tables.transactions}
            WHERE (LOWER(type) = 'deposit' OR LOWER(type) = 'mpesa deposit' OR LOWER(type) = 'admin deposit' OR LOWER(type) LIKE '%deposit%')
              AND LOWER(status) = 'success'
              AND created_at >= CURRENT_DATE;
          `);
        }
        const todayTotal = parseFloat(todayStatsQuery.rows[0]?.today_total || 0);
        const todayCount = parseInt(todayStatsQuery.rows[0]?.today_count || 0);

        // 4. Feature 2: Fetch Registered Users Directory
        let userWhere = '1=1';
        const userParams = [];
        if (user_search && user_search.trim()) {
          userWhere = 'phone ILIKE $1';
          userParams.push(`%${user_search.trim()}%`);
        }
        const usersQuery = await query(`
          SELECT phone, balance, created_at 
          FROM ${tables.users}
          WHERE ${userWhere}
          ORDER BY balance DESC, created_at DESC
          LIMIT 100;
        `, userParams);

        return res.status(200).json({
          success: true,
          authenticated: true,
          app_id: appId,
          // Flat properties for frontend compatibility
          min_deposit: parseFloat(dbSettings.min_deposit || 300.00),
          min_withdrawal: parseFloat(dbSettings.min_withdrawal || 500.00),
          min_stake: parseFloat(dbSettings.min_stake || 400.00),
          active_gateway: dbSettings.active_gateway || 'gravitypay',
          aviator_speed: dbSettings.aviator_speed || 'normal',
          payhero_username: dbSettings.payhero_username || '',
          payhero_password: dbSettings.payhero_password || '',
          payhero_channel_id: dbSettings.payhero_channel_id || '',
          payhero_callback_url: dbSettings.payhero_callback_url || '',
          tinypesa_api_key: dbSettings.tinypesa_api_key || '',
          tinypesa_account_no: dbSettings.tinypesa_account_no || '',
          gravitypay_api_key: dbSettings.gravitypay_api_key || '',
          gravitypay_secret_key: dbSettings.gravitypay_secret_key || '',
          gravitypay_webhook_secret: dbSettings.gravitypay_webhook_secret || '',
          admin_passcode: dbSettings.admin_passcode,
          crash_point: activeRound.crashPoint,
          crash_point_2: activeRound.crashPoint2,
          crash_point_3: activeRound.crashPoint3,
          // Structured nested properties
          settings: {
            min_deposit: parseFloat(dbSettings.min_deposit || 300.00),
            min_withdrawal: parseFloat(dbSettings.min_withdrawal || 500.00),
            min_stake: parseFloat(dbSettings.min_stake || 400.00),
            active_gateway: dbSettings.active_gateway || 'gravitypay',
            aviator_speed: dbSettings.aviator_speed || 'normal',
            payhero_username: dbSettings.payhero_username || '',
            payhero_password: dbSettings.payhero_password || '',
            payhero_channel_id: dbSettings.payhero_channel_id || '',
            payhero_callback_url: dbSettings.payhero_callback_url || '',
            tinypesa_api_key: dbSettings.tinypesa_api_key || '',
            tinypesa_account_no: dbSettings.tinypesa_account_no || '',
            gravitypay_api_key: dbSettings.gravitypay_api_key || '',
            gravitypay_secret_key: dbSettings.gravitypay_secret_key || '',
            gravitypay_webhook_secret: dbSettings.gravitypay_webhook_secret || '',
            admin_passcode: dbSettings.admin_passcode
          },
          predictor: {
            crash_point: activeRound.crashPoint,
            crash_point_2: activeRound.crashPoint2,
            crash_point_3: activeRound.crashPoint3,
            phase: activeRound.phase,
            speed: activeRound.speedSetting
          },
          deposits: depositsQuery.rows.map(row => ({
            phone: row.phone,
            amount: parseFloat(row.amount),
            reference: row.reference,
            created_at: row.created_at
          })),
          deposit_stats: {
            filtered_total: filteredTotal,
            filtered_count: filteredCount,
            today_total: todayTotal,
            today_count: todayCount
          },
          users: usersQuery.rows.map(u => ({
            phone: u.phone,
            balance: parseFloat(u.balance || 0.00),
            created_at: u.created_at
          }))
        });
      }

      // No passcode or wrong passcode — return only public limits
      return res.status(200).json({
        success: true,
        authenticated: false,
        app_id: appId,
        min_deposit: parseFloat(dbSettings.min_deposit || 300.00),
        min_withdrawal: parseFloat(dbSettings.min_withdrawal || 500.00),
        min_stake: parseFloat(dbSettings.min_stake || 400.00),
        active_gateway: dbSettings.active_gateway || 'gravitypay',
        aviator_speed: dbSettings.aviator_speed || 'normal'
      });

    } catch (err) {
      console.error("GET settings error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. POST Request
  if (req.method === 'POST') {
    const {
      action,
      passcode,
      target_phone,
      phone,
      amount,
      min_deposit,
      min_withdrawal,
      min_stake,
      active_gateway,
      aviator_speed,
      payhero_username,
      payhero_password,
      payhero_channel_id,
      payhero_callback_url,
      tinypesa_api_key,
      tinypesa_account_no,
      gravitypay_api_key,
      gravitypay_secret_key,
      gravitypay_webhook_secret,
      gravitypay_signing_secret,
      new_passcode,
      admin_passcode,
      crash_point,
      crash_point_2,
      crash_point_3
    } = req.body;

    if (!passcode) {
      return res.status(403).json({ error: 'Authentication required. Admin passcode is missing.' });
    }

    try {
      // Ensure database tables exist for this tenant
      try {
        await initAppDatabase(req);
      } catch (_) {}

      // Validate active passcode from this app's settings table
      let settingsQuery = await query(`
        SELECT * FROM ${tables.settings} WHERE id = $1;
      `, [appId]);

      if (settingsQuery.rows.length === 0) {
        settingsQuery = await query(`SELECT * FROM ${tables.settings} LIMIT 1;`);
      }

      if (settingsQuery.rows.length === 0) {
        return res.status(500).json({ error: `Settings row not found for ${appId}. Please initialize DB.` });
      }

      const activePasscode = settingsQuery.rows[0]?.admin_passcode || 'Aa@123';
      if (passcode.toString().trim() !== activePasscode.toString().trim()) {
        return res.status(401).json({ error: 'Invalid admin passcode. Access denied.' });
      }

      // Feature: Instant Admin Top-Up / Balance Crediting
      if (action === 'topup_user') {
        const credPhone = target_phone || phone;
        const credAmount = parseFloat(amount);

        if (!credPhone || isNaN(credAmount) || credAmount <= 0) {
          return res.status(400).json({ error: 'Valid phone number and positive amount (> 0) are required.' });
        }

        const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(credPhone);
        if (!primary) {
          return res.status(400).json({ error: 'Invalid phone number format.' });
        }

        // Ensure user exists (or import from sister tables)
        let user = await findUserOrImport(credPhone, tables);
        if (!user) {
          user = await ensureUser(credPhone, tables);
        }

        // Atomically update user balance
        let updateRes = await query(`
          UPDATE ${tables.users}
          SET balance = ROUND(balance + $1, 2)
          WHERE phone = $2 OR phone = $3 OR phone = $4
          RETURNING phone, balance;
        `, [credAmount, phone254, phone0, phoneShort]);

        if (updateRes.rows.length === 0) {
          updateRes = await query(`
            INSERT INTO ${tables.users} (phone, balance, password_hash)
            VALUES ($1, $2, 'NO_PASSWORD_MIGRATED')
            ON CONFLICT (phone) DO UPDATE
            SET balance = ROUND(${tables.users}.balance + $2, 2)
            RETURNING phone, balance;
          `, [primary, credAmount]);
        }

        const updatedPhone = updateRes.rows[0]?.phone || primary;
        const updatedBalance = parseFloat(updateRes.rows[0]?.balance || (parseFloat(user?.balance || 0) + credAmount));

        // Insert verified record into transactions table
        const admRef = `ADM${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        await query(`
          INSERT INTO ${tables.transactions} (phone, type, amount, status, reference, created_at)
          VALUES ($1, 'Admin Deposit', $2, 'Success', $3, NOW());
        `, [updatedPhone, credAmount, admRef]);

        console.log(`[Admin Topup] Credited KES ${credAmount} to ${updatedPhone}. New balance: KES ${updatedBalance} (Ref: ${admRef})`);

        return res.status(200).json({
          success: true,
          message: `Successfully credited KES ${credAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} to ${updatedPhone}`,
          phone: updatedPhone,
          new_balance: updatedBalance,
          amount_credited: credAmount,
          reference: admRef
        });
      }

      // Perform standard system settings updates if provided
      if (
        min_deposit !== undefined ||
        min_withdrawal !== undefined ||
        min_stake !== undefined ||
        active_gateway !== undefined ||
        aviator_speed !== undefined ||
        payhero_username !== undefined ||
        payhero_password !== undefined ||
        payhero_channel_id !== undefined ||
        payhero_callback_url !== undefined ||
        tinypesa_api_key !== undefined ||
        tinypesa_account_no !== undefined ||
        gravitypay_api_key !== undefined ||
        gravitypay_secret_key !== undefined ||
        gravitypay_webhook_secret !== undefined ||
        gravitypay_signing_secret !== undefined ||
        new_passcode !== undefined ||
        admin_passcode !== undefined
      ) {
        const updatePasscode = (new_passcode || admin_passcode || activePasscode).toString().trim();
        const gpSecretVal = gravitypay_signing_secret !== undefined ? gravitypay_signing_secret : (gravitypay_webhook_secret !== undefined ? gravitypay_webhook_secret : null);
        
        // Ensure row exists for this specific appId
        await query(`
          INSERT INTO ${tables.settings} (id, min_deposit, min_withdrawal, min_stake, active_gateway, aviator_speed, admin_passcode)
          VALUES ($1, 300.00, 500.00, 400.00, 'gravitypay', 'normal', $2)
          ON CONFLICT (id) DO NOTHING;
        `, [appId, updatePasscode]);

        await query(`
          UPDATE ${tables.settings}
          SET min_deposit = COALESCE($1, min_deposit),
              min_withdrawal = COALESCE($2, min_withdrawal),
              min_stake = COALESCE($3, min_stake),
              active_gateway = COALESCE($4, active_gateway),
              aviator_speed = COALESCE($5, aviator_speed),
              payhero_username = COALESCE($6, payhero_username),
              payhero_password = COALESCE($7, payhero_password),
              payhero_channel_id = COALESCE($8, payhero_channel_id),
              payhero_callback_url = COALESCE($9, payhero_callback_url),
              tinypesa_api_key = COALESCE($10, tinypesa_api_key),
              tinypesa_account_no = COALESCE($11, tinypesa_account_no),
              gravitypay_api_key = COALESCE($12, gravitypay_api_key),
              gravitypay_secret_key = COALESCE($13, gravitypay_secret_key),
              gravitypay_webhook_secret = COALESCE($14, gravitypay_webhook_secret),
              admin_passcode = $15
          WHERE id = $16;
        `, [
          min_deposit !== undefined ? parseFloat(min_deposit) : null,
          min_withdrawal !== undefined ? parseFloat(min_withdrawal) : null,
          min_stake !== undefined ? parseFloat(min_stake) : null,
          active_gateway !== undefined ? active_gateway.toLowerCase().trim() : null,
          aviator_speed !== undefined ? aviator_speed.toLowerCase().trim() : null,
          payhero_username !== undefined ? payhero_username : null,
          payhero_password !== undefined ? payhero_password : null,
          payhero_channel_id !== undefined ? payhero_channel_id : null,
          payhero_callback_url !== undefined ? payhero_callback_url : null,
          tinypesa_api_key !== undefined ? tinypesa_api_key : null,
          tinypesa_account_no !== undefined ? tinypesa_account_no : null,
          gravitypay_api_key !== undefined ? gravitypay_api_key : null,
          gravitypay_secret_key !== undefined ? gravitypay_secret_key : null,
          gpSecretVal,
          updatePasscode,
          appId
        ]);
      }

      // Handle predictor outcome overrides
      if (crash_point !== undefined || crash_point_2 !== undefined || crash_point_3 !== undefined) {
        const cp1 = crash_point !== undefined ? parseFloat(crash_point) : null;
        const cp2 = crash_point_2 !== undefined ? parseFloat(crash_point_2) : null;
        const cp3 = crash_point_3 !== undefined ? parseFloat(crash_point_3) : null;

        await query(`
          INSERT INTO ${tables.active_rounds} (phone, crash_point, crash_point_2, crash_point_3, status, created_at)
          VALUES ($1, COALESCE($2, 1.50), COALESCE($3, 2.20), COALESCE($4, 1.30), 'ACTIVE', NOW())
          ON CONFLICT (phone) DO UPDATE
          SET crash_point = COALESCE($2, ${tables.active_rounds}.crash_point),
              crash_point_2 = COALESCE($3, ${tables.active_rounds}.crash_point_2),
              crash_point_3 = COALESCE($4, ${tables.active_rounds}.crash_point_3),
              status = 'ACTIVE';
        `, [appId, cp1, cp2, cp3]);
      }

      return res.status(200).json({ success: true, app_id: appId, message: `Settings for '${appId}' updated successfully.` });

    } catch (err) {
      console.error("POST settings error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
