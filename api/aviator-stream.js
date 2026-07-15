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

  // Generate game round details
  const instantCrash = Math.random() < 0.02; // 2% instant crash
  let crashPoint = 1.00;
  if (!instantCrash) {
    // Generate crash point.
    // Cap at 15.00x so it safely fits within the Vercel 60s execution limit (60s corresponds to ~13.1x).
    crashPoint = Math.max(1.01, 0.98 / Math.random());
    if (crashPoint > 15.00) crashPoint = 15.00;
  }

  console.log(`Starting secure Aviator stream for ${cleanPhone}. Crash limit: ${crashPoint.toFixed(2)}`);

  // Write active round to DB
  try {
    await sql`
      INSERT INTO helakash_active_rounds (phone, crash_point)
      VALUES (${cleanPhone}, ${crashPoint})
      ON CONFLICT (phone)
      DO UPDATE SET crash_point = ${crashPoint}, created_at = NOW();
    `;
  } catch (error) {
    console.error("DB insert error in aviator-stream:", error);
  }

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
      DELETE FROM helakash_active_rounds WHERE phone = ${phone};
    `;
    console.log(`Cleaned up active round for ${phone}`);
  } catch (error) {
    console.error("DB delete error in stream cleanup:", error);
  }
}
