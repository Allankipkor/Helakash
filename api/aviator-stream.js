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

  let crashPoint, crashPoint2, crashPoint3;
  try {
    const existing = await sql`
      SELECT crash_point, crash_point_2, crash_point_3 FROM helakash_active_rounds WHERE phone = ${cleanPhone};
    `;

    if (existing.rows.length > 0) {
      // Shift points: crash_point_2 becomes crash_point, crash_point_3 becomes crash_point_2, and new crash_point_3
      const row = existing.rows[0];
      crashPoint = parseFloat(row.crash_point_2) || generateCrashPoint();
      crashPoint2 = parseFloat(row.crash_point_3) || generateCrashPoint();
      crashPoint3 = generateCrashPoint();

      console.log(`Shifting crash points for ${cleanPhone}: ${row.crash_point} -> ${crashPoint} -> ${crashPoint2} -> ${crashPoint3}`);

      await sql`
        UPDATE helakash_active_rounds
        SET crash_point = ${crashPoint},
            crash_point_2 = ${crashPoint2},
            crash_point_3 = ${crashPoint3},
            status = 'ACTIVE',
            created_at = NOW()
        WHERE phone = ${cleanPhone};
      `;
    } else {
      // Create new initial set of 3 crash points
      crashPoint = generateCrashPoint();
      crashPoint2 = generateCrashPoint();
      crashPoint3 = generateCrashPoint();

      console.log(`Generating initial crash points for ${cleanPhone}: ${crashPoint}, ${crashPoint2}, ${crashPoint3}`);

      await sql`
        INSERT INTO helakash_active_rounds (phone, crash_point, crash_point_2, crash_point_3, status)
        VALUES (${cleanPhone}, ${crashPoint}, ${crashPoint2}, ${crashPoint3}, 'ACTIVE');
      `;
    }
  } catch (dbError) {
    console.error("DB error in aviator-stream initialization:", dbError);
    crashPoint = generateCrashPoint();
    crashPoint2 = generateCrashPoint();
    crashPoint3 = generateCrashPoint();
  }

  console.log(`Starting secure Aviator stream for ${cleanPhone}. Crash limit: ${crashPoint.toFixed(2)}`);

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
  let countdownElapsed = 0;

  const runWaiting = () => {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        countdownElapsed += countdownInterval;
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
  const startTime = Date.now();
  const tickInterval = 100;

  const runFlying = () => {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        // Same growth formula as the original client-side simulation
        const currentMult = 1.0 + Math.pow(elapsed / 7500, 1.2);

        if (currentMult >= crashPoint) {
          clearInterval(interval);
          sendEvent('crashed', { multiplier: crashPoint });
          await cleanUpRound(cleanPhone);
          res.end();
          resolve(false);
        } else {
          sendEvent('tick', { multiplier: currentMult });
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
