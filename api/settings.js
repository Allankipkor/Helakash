import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export default async function handler(req, res) {
  const method = req.method;

  if (method === 'GET') {
    try {
      // 1. Fetch current settings from database
      const settingsQuery = await sql`SELECT * FROM helakash_settings WHERE id = 'global';`;
      if (settingsQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Settings not found in database. Please run init-db.' });
      }

      const settings = settingsQuery.rows[0];
      const { passcode } = req.query;

      // 2. If valid admin passcode is provided, return all details (including credentials and crash points)
      if (passcode && passcode === settings.admin_passcode) {
        // Fetch current active rounds for global session
        const roundsQuery = await sql`
          SELECT crash_point, crash_point_2, crash_point_3 
          FROM helakash_active_rounds 
          WHERE phone = 'global';
        `;
        const rounds = roundsQuery.rows[0] || { crash_point: 1.50, crash_point_2: 2.20, crash_point_3: 1.30 };

        // Fetch successful deposit transactions
        let depositsQuery;
        try {
          depositsQuery = await sql`
            SELECT id, phone, amount, reference, created_at,
                   TO_CHAR(COALESCE(created_at, CURRENT_TIMESTAMP) AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') as db_time
            FROM helakash_transactions 
            WHERE (type ILIKE '%Deposit%') AND (status ILIKE '%success%') 
            ORDER BY created_at DESC, id DESC 
            LIMIT 50;
          `;
        } catch (sqlErr) {
          console.warn("Falling back to standard SELECT for transactions:", sqlErr.message);
          depositsQuery = await sql`
            SELECT id, phone, amount, reference, created_at
            FROM helakash_transactions 
            WHERE (type ILIKE '%Deposit%') AND (status ILIKE '%success%') 
            ORDER BY created_at DESC, id DESC 
            LIMIT 50;
          `;
        }

        const deposits = depositsQuery.rows.map(d => {
          let isoDate = '';
          let timeFormatted = d.db_time || '';
          let dt = null;

          if (d.created_at instanceof Date) {
            dt = d.created_at;
            isoDate = dt.toISOString();
          } else if (d.created_at) {
            dt = new Date(d.created_at);
            isoDate = isNaN(dt.getTime()) ? String(d.created_at) : dt.toISOString();
          } else {
            dt = new Date();
            isoDate = dt.toISOString();
          }

          if (!timeFormatted && dt && !isNaN(dt.getTime())) {
            try {
              timeFormatted = dt.toLocaleTimeString('en-GB', {
                timeZone: 'Africa/Nairobi',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
              });
            } catch (e) {
              timeFormatted = dt.toISOString().substring(11, 16);
            }
          }

          if (!timeFormatted) {
            timeFormatted = '--:--';
          }

          return {
            id: d.id,
            phone: d.phone,
            amount: parseFloat(d.amount),
            reference: d.reference || '',
            created_at: isoDate,
            date: isoDate,
            time: timeFormatted,
            db_time: d.db_time || timeFormatted,
            raw_time: d.created_at
          };
        });

        return res.status(200).json({
          success: true,
          authenticated: true,
          min_deposit: parseFloat(settings.min_deposit),
          min_withdrawal: parseFloat(settings.min_withdrawal),
          min_stake: parseFloat(settings.min_stake),
          payhero_username: settings.payhero_username || '',
          payhero_password: settings.payhero_password || '',
          payhero_channel_id: settings.payhero_channel_id || '',
          payhero_callback_url: settings.payhero_callback_url || '',
          paystack_secret_key: settings.paystack_secret_key || '',
          paystack_public_key: settings.paystack_public_key || '',
          admin_passcode: settings.admin_passcode,
          crash_point: parseFloat(rounds.crash_point),
          crash_point_2: parseFloat(rounds.crash_point_2),
          crash_point_3: parseFloat(rounds.crash_point_3),
          deposits: deposits
        });
      }

      // 3. Otherwise, return only public parameters
      return res.status(200).json({
        success: true,
        authenticated: false,
        min_deposit: parseFloat(settings.min_deposit),
        min_withdrawal: parseFloat(settings.min_withdrawal),
        min_stake: parseFloat(settings.min_stake)
      });
    } catch (error) {
      console.error("Error fetching settings:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (method === 'POST') {
    try {
      const {
        passcode,
        min_deposit,
        min_withdrawal,
        min_stake,
        payhero_username,
        payhero_password,
        payhero_channel_id,
        payhero_callback_url,
        paystack_secret_key,
        paystack_public_key,
        admin_passcode,
        crash_point,
        crash_point_2,
        crash_point_3
      } = req.body;

      // 1. Fetch settings to authenticate
      const settingsQuery = await sql`SELECT admin_passcode FROM helakash_settings WHERE id = 'global';`;
      if (settingsQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Settings not initialized.' });
      }

      const dbPasscode = settingsQuery.rows[0].admin_passcode;
      if (!passcode || passcode !== dbPasscode) {
        return res.status(403).json({ error: 'Unauthorized: Invalid admin passcode.' });
      }

      // 2. Handle updating settings if provided
      if (min_deposit !== undefined) {
        await sql`
          UPDATE helakash_settings
          SET min_deposit = ${parseFloat(min_deposit)},
              min_withdrawal = ${parseFloat(min_withdrawal)},
              min_stake = ${parseFloat(min_stake)},
              payhero_username = ${payhero_username || null},
              payhero_password = ${payhero_password || null},
              payhero_channel_id = ${payhero_channel_id || null},
              payhero_callback_url = ${payhero_callback_url || null},
              paystack_secret_key = ${paystack_secret_key || null},
              paystack_public_key = ${paystack_public_key || null},
              admin_passcode = ${admin_passcode || dbPasscode}
          WHERE id = 'global';
        `;
      }

      // 3. Handle updating active rounds / crash point overrides if provided
      if (crash_point !== undefined) {
        await sql`
          INSERT INTO helakash_active_rounds (phone, crash_point, crash_point_2, crash_point_3, status)
          VALUES ('global', ${parseFloat(crash_point)}, ${parseFloat(crash_point_2)}, ${parseFloat(crash_point_3)}, 'ACTIVE')
          ON CONFLICT (phone) DO UPDATE
          SET crash_point = ${parseFloat(crash_point)},
              crash_point_2 = ${parseFloat(crash_point_2)},
              crash_point_3 = ${parseFloat(crash_point_3)},
              status = 'ACTIVE',
              created_at = NOW();
        `;
      }

      return res.status(200).json({ success: true, message: 'Settings updated successfully' });
    } catch (error) {
      console.error("Error updating settings:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
