import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export const config = {
  maxDuration: 60, // Maximum execution duration for Vercel functions (60s on Hobby tier)
};

export default async function handler(req, res) {
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
    if (point > 15.00) point = 15.00;
    return parseFloat(point.toFixed(2));
  }

  let crashPoint, crashPoint2, crashPoint3, globalCreatedAt;
  
  try {
    // 1. Fetch global active round
    let globalQuery = await sql`
      SELECT crash_point, crash_point_2, crash_point_3, created_at FROM helakash_active_rounds WHERE phone = 'global';
    `;

    if (globalQuery.rows.length === 0) {
      // Create initial global round if missing
      crashPoint = generateCrashPoint();
      crashPoint2 = generateCrashPoint();
      crashPoint3 = generateCrashPoint();
      await sql`
        INSERT INTO helakash_active_rounds (phone, crash_point, crash_point_2, crash_point_3, status, created_at)
        VALUES ('global', ${crashPoint}, ${crashPoint2}, ${crashPoint3}, 'ACTIVE', NOW());
      `;
      globalQuery = await sql`
        SELECT crash_point, crash_point_2, crash_point_3, created_at FROM helakash_active_rounds WHERE phone = 'global';
      `;
    }

    let globalRow = globalQuery.rows[0];
    crashPoint = parseFloat(globalRow.crash_point);
    crashPoint2 = parseFloat(globalRow.crash_point_2);
    crashPoint3 = parseFloat(globalRow.crash_point_3);
    globalCreatedAt = new Date(globalRow.created_at).getTime();

    // 2. Solve duration limits for the current global round
    const flightDurationLimit = Math.floor(7500 * Math.pow(crashPoint - 1.0, 1 / 1.2));
    const countdownDuration = 7500;
    const postCrashDuration = 3000;
    const totalRoundDuration = countdownDuration + flightDurationLimit + postCrashDuration;

    let elapsedTotal = Date.now() - globalCreatedAt;

    // 3. Shift the global round if it has expired
    if (elapsedTotal >= totalRoundDuration) {
      const nextCp = generateCrashPoint();
      const updateResult = await sql`
        UPDATE helakash_active_rounds
        SET crash_point = crash_point_2,
            crash_point_2 = crash_point_3,
            crash_point_3 = ${nextCp},
            status = 'ACTIVE',
            created_at = NOW()
        WHERE phone = 'global' AND created_at = ${globalRow.created_at};
      `;

      // Re-read updated global round parameters (whether we updated it or a concurrent request did)
      const reQuery = await sql`
        SELECT crash_point, crash_point_2, crash_point_3, created_at FROM helakash_active_rounds WHERE phone = 'global';
      `;
      globalRow = reQuery.rows[0];
      crashPoint = parseFloat(globalRow.crash_point);
      crashPoint2 = parseFloat(globalRow.crash_point_2);
      crashPoint3 = parseFloat(globalRow.crash_point_3);
      globalCreatedAt = new Date(globalRow.created_at).getTime();
      elapsedTotal = Date.now() - globalCreatedAt;
    }

    // 4. Align individual user active round status in database
    await sql`
      INSERT INTO helakash_active_rounds (phone, crash_point, crash_point_2, crash_point_3, status, created_at)
      VALUES (${cleanPhone}, ${crashPoint}, ${crashPoint2}, ${crashPoint3}, 'ACTIVE', ${new Date(globalCreatedAt)})
      ON CONFLICT (phone) DO UPDATE 
      SET crash_point = ${crashPoint},
          crash_point_2 = ${crashPoint2},
          crash_point_3 = ${crashPoint3},
          status = 'ACTIVE',
          created_at = ${new Date(globalCreatedAt)};
    `;

  } catch (dbError) {
    console.error("DB error in aviator-stream initialization:", dbError);
    crashPoint = generateCrashPoint();
    crashPoint2 = generateCrashPoint();
    crashPoint3 = generateCrashPoint();
    globalCreatedAt = Date.now();
  }

  console.log(`Starting secure synchronized Aviator stream for ${cleanPhone}. Crash limit: ${crashPoint.toFixed(2)}`);

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  };

  // 1. Waiting / Takeoff countdown phase (7500ms)
  const countdownDuration = 7500;
  const countdownInterval = 100;
  
  // Calculate remaining waiting time based on elapsed total round time
  let countdownElapsed = Math.max(0, Date.now() - globalCreatedAt);

  const runWaiting = () => {
    return new Promise((resolve) => {
      // If countdown has already passed, skip immediately
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
    await cleanUpRound(cleanPhone);
    res.end();
    return;
  }

  // 2. Flying phase
  const tickInterval = 100;
  const flightDurationLimit = Math.floor(7500 * Math.pow(crashPoint - 1.0, 1 / 1.2));

  const runFlying = () => {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const now = Date.now();
        const elapsedFlight = now - (globalCreatedAt + countdownDuration);

        // If flight duration limit is reached, crash the plane
        if (elapsedFlight >= flightDurationLimit) {
          clearInterval(interval);
          sendEvent('crashed', { multiplier: crashPoint });
          await cleanUpRound(cleanPhone);
          res.end();
          resolve(false);
          return;
        }

        if (elapsedFlight <= 0) {
          return; // Still transitioning from waiting to flight
        }

        // Growth formula matching client
        const currentMult = 1.0 + Math.pow(elapsedFlight / 7500, 1.2);

        if (currentMult >= crashPoint) {
          clearInterval(interval);
          sendEvent('crashed', { multiplier: crashPoint });
          await cleanUpRound(cleanPhone);
          res.end();
          resolve(false);
        } else {
          // Send elapsed time so client can synchronize animations perfectly
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
    await cleanUpRound(cleanPhone);
    res.end();
  }
}

async function cleanUpRound(phone) {
  try {
    await sql`
      UPDATE helakash_active_rounds 
      SET status = 'CRASHED' 
      WHERE phone = ${phone};
    `;
    console.log(`Marked active round as CRASHED for ${phone}`);
  } catch (error) {
    console.error("DB update error in stream cleanup:", error);
  }
}
