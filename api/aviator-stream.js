import { query, getAppId, getTables } from './db.js';

export const config = {
  maxDuration: 60, // Maximum execution duration for Vercel functions (60s on Hobby tier)
};

export default async function handler(req, res) {
  const appId = getAppId(req);
  const tables = getTables(req);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const phone = req.query.phone || `guest_${Math.random().toString(36).substring(2, 9)}`;

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

  // Helper function to generate crash point securely
  function generateCrashPoint() {
    const instantCrash = Math.random() < 0.02; // 2% instant crash
    if (instantCrash) return 1.00;
    let point = Math.max(1.01, 0.98 / Math.random());
    if (point > 80.00) point = 80.00;
    return parseFloat(point.toFixed(2));
  }

  let crashPoint, crashPoint2, crashPoint3, globalCreatedAt;
  
  try {
    // 1. Fetch active round for this specific app
    let globalQuery = await query(`
      SELECT crash_point, crash_point_2, crash_point_3, created_at,
             EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS elapsed_ms
      FROM ${tables.active_rounds} 
      WHERE phone = $1;
    `, [appId]);

    if (globalQuery.rows.length === 0) {
      globalQuery = await query(`
        SELECT crash_point, crash_point_2, crash_point_3, created_at,
               EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS elapsed_ms
        FROM ${tables.active_rounds} 
        LIMIT 1;
      `);
    }

    if (globalQuery.rows.length === 0) {
      // Create initial round if missing
      crashPoint = generateCrashPoint();
      crashPoint2 = generateCrashPoint();
      crashPoint3 = generateCrashPoint();
      await query(`
        INSERT INTO ${tables.active_rounds} (phone, crash_point, crash_point_2, crash_point_3, status, created_at)
        VALUES ($1, $2, $3, $4, 'ACTIVE', NOW());
      `, [appId, crashPoint, crashPoint2, crashPoint3]);

      globalQuery = await query(`
        SELECT crash_point, crash_point_2, crash_point_3, created_at,
               EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS elapsed_ms
        FROM ${tables.active_rounds} 
        WHERE phone = $1;
      `, [appId]);
    }

    let globalRow = globalQuery.rows[0];
    crashPoint = parseFloat(globalRow.crash_point);
    crashPoint2 = parseFloat(globalRow.crash_point_2);
    crashPoint3 = parseFloat(globalRow.crash_point_3);
    const elapsedMs = parseFloat(globalRow.elapsed_ms);

    // 2. Solve duration limits for the current round
    const flightDurationLimit = Math.floor(5500 * Math.pow(crashPoint - 1.0, 1 / 1.88));
    const countdownDuration = 7500;
    const postCrashDuration = 3000;
    const totalRoundDuration = countdownDuration + flightDurationLimit + postCrashDuration;

    let elapsedTotal = elapsedMs;

    // 3. Shift the round if it has expired
    if (elapsedTotal >= totalRoundDuration) {
      const nextCp = generateCrashPoint();
      await query(`
        UPDATE ${tables.active_rounds}
        SET crash_point = crash_point_2,
            crash_point_2 = crash_point_3,
            crash_point_3 = $1,
            status = 'ACTIVE',
            created_at = NOW()
        WHERE phone = $2
          AND EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 >= $3;
      `, [nextCp, appId, totalRoundDuration]);

      // Re-read updated round parameters
      const reQuery = await query(`
        SELECT crash_point, crash_point_2, crash_point_3, created_at,
               EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS elapsed_ms
        FROM ${tables.active_rounds} 
        WHERE phone = $1
        ORDER BY created_at DESC
        LIMIT 1;
      `, [appId]);

      globalRow = reQuery.rows[0];
      crashPoint = parseFloat(globalRow.crash_point);
      crashPoint2 = parseFloat(globalRow.crash_point_2);
      crashPoint3 = parseFloat(globalRow.crash_point_3);
      globalCreatedAt = Date.now() - parseFloat(globalRow.elapsed_ms);
    } else {
      globalCreatedAt = Date.now() - elapsedTotal;
    }

    // 4. Align individual user active round status in database
    await query(`
      INSERT INTO ${tables.active_rounds} (phone, crash_point, crash_point_2, crash_point_3, status, created_at)
      VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
      ON CONFLICT (phone) DO UPDATE 
      SET crash_point = $2,
          crash_point_2 = $3,
          crash_point_3 = $4,
          status = 'ACTIVE',
          created_at = $5;
    `, [cleanPhone, crashPoint, crashPoint2, crashPoint3, globalRow.created_at]);

  } catch (dbError) {
    console.error("DB error in aviator-stream initialization:", dbError);
    crashPoint = generateCrashPoint();
    crashPoint2 = generateCrashPoint();
    crashPoint3 = generateCrashPoint();
    globalCreatedAt = Date.now();
  }

  console.log(`Starting secure synchronized Aviator stream for ${cleanPhone} on ${appId}. Crash limit: ${crashPoint.toFixed(2)}`);

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  };

  // 1. Waiting / Takeoff countdown phase (7500ms)
  const countdownDuration = 7500;
  const countdownInterval = 100;
  
  let countdownElapsed = Math.max(0, Date.now() - globalCreatedAt);

  const runWaiting = () => {
    return new Promise((resolve) => {
      if (countdownElapsed >= countdownDuration) {
        resolve(false);
        return;
      }

      const interval = setInterval(() => {
        countdownElapsed = Date.now() - globalCreatedAt;
        const remaining = Math.max(0, countdownDuration - countdownElapsed);
        sendEvent('waiting', { remaining });

        if (remaining <= 0) {
          clearInterval(interval);
          resolve(false);
        }
      }, countdownInterval);

      req.on('close', () => {
        clearInterval(interval);
        resolve(true); // cancelled
      });
    });
  };

  const wasCancelled = await runWaiting();
  if (wasCancelled) {
    await cleanUpRound(cleanPhone, tables);
    res.end();
    return;
  }

  // 2. Flying phase
  const tickInterval = 100;
  const flightDurationLimit = Math.floor(5500 * Math.pow(crashPoint - 1.0, 1 / 1.88));

  const runFlying = () => {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const now = Date.now();
        const elapsedFlight = now - (globalCreatedAt + countdownDuration);

        if (elapsedFlight >= flightDurationLimit) {
          clearInterval(interval);
          sendEvent('crashed', { multiplier: crashPoint });
          await cleanUpRound(cleanPhone, tables);
          res.end();
          resolve(false);
          return;
        }

        if (elapsedFlight <= 0) {
          return;
        }

        const currentMult = 1.0 + Math.pow(elapsedFlight / 5500, 1.88);

        if (currentMult >= crashPoint) {
          clearInterval(interval);
          sendEvent('crashed', { multiplier: crashPoint });
          await cleanUpRound(cleanPhone, tables);
          res.end();
          resolve(false);
        } else {
          sendEvent('tick', { multiplier: currentMult, elapsed: elapsedFlight });
        }
      }, tickInterval);

      req.on('close', () => {
        clearInterval(interval);
        resolve(true); // cancelled
      });
    });
  };

  const flightCancelled = await runFlying();
  if (flightCancelled) {
    await cleanUpRound(cleanPhone, tables);
    res.end();
  }
}

async function cleanUpRound(phone, tables) {
  try {
    await query(`
      UPDATE ${tables.active_rounds} 
      SET status = 'CRASHED' 
      WHERE phone = $1;
    `, [phone]);
    console.log(`Marked active round as CRASHED for ${phone}`);
  } catch (error) {
    console.error("DB update error in stream cleanup:", error);
  }
}
