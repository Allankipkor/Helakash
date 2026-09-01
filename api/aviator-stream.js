import { getAppId, getTables, getOrAdvanceGlobalActiveRound } from './db.js';

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

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (res.flush) res.flush();
    } catch (_) {}
  };

  let isClosed = false;
  req.on('close', () => {
    isClosed = true;
  });

  try {
    // 1. Fetch current authoritative global round state
    const roundState = await getOrAdvanceGlobalActiveRound(appId, tables);
    const {
      crashPoint,
      speedParams,
      flightDurationLimit,
      countdownDuration,
      createdAt
    } = roundState;

    const globalCreatedAtMs = new Date(createdAt).getTime();

    // If client connects while already in 'crashed' phase, send crash and close so they reconnect for new round
    if (roundState.phase === 'crashed') {
      sendEvent('crashed', { multiplier: crashPoint });
      setTimeout(() => {
        if (!isClosed) res.end();
      }, Math.max(200, roundState.remainingMs));
      return;
    }

    // 2. Waiting / Takeoff countdown phase (7500ms)
    const runWaiting = () => {
      return new Promise((resolve) => {
        const now = Date.now();
        const countdownElapsed = Math.max(0, now - globalCreatedAtMs);

        if (countdownElapsed >= countdownDuration) {
          resolve(false);
          return;
        }

        const interval = setInterval(() => {
          if (isClosed) {
            clearInterval(interval);
            resolve(true);
            return;
          }

          const currentNow = Date.now();
          const elapsed = currentNow - globalCreatedAtMs;
          const remaining = Math.max(0, countdownDuration - elapsed);

          sendEvent('waiting', {
            remaining,
            speed: speedParams.speed,
            divisor: speedParams.divisor,
            exponent: speedParams.exponent
          });

          if (remaining <= 0) {
            clearInterval(interval);
            resolve(false);
          }
        }, 100);
      });
    };

    const wasCancelled = await runWaiting();
    if (wasCancelled || isClosed) {
      if (!isClosed) res.end();
      return;
    }

    // 3. Flying phase
    const runFlying = () => {
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          if (isClosed) {
            clearInterval(interval);
            resolve(true);
            return;
          }

          const now = Date.now();
          const elapsedFlight = now - (globalCreatedAtMs + countdownDuration);

          if (elapsedFlight <= 0) {
            return;
          }

          if (elapsedFlight >= flightDurationLimit) {
            clearInterval(interval);
            sendEvent('crashed', { multiplier: crashPoint });
            setTimeout(() => {
              if (!isClosed) res.end();
            }, 500);
            resolve(false);
            return;
          }

          const currentMult = 1.0 + Math.pow(elapsedFlight / speedParams.divisor, speedParams.exponent);

          if (currentMult >= crashPoint) {
            clearInterval(interval);
            sendEvent('crashed', { multiplier: crashPoint });
            setTimeout(() => {
              if (!isClosed) res.end();
            }, 500);
            resolve(false);
          } else {
            sendEvent('tick', {
              multiplier: parseFloat(currentMult.toFixed(2)),
              elapsed: elapsedFlight,
              speed: speedParams.speed,
              divisor: speedParams.divisor,
              exponent: speedParams.exponent
            });
          }
        }, 100);
      });
    };

    await runFlying();

  } catch (err) {
    console.error("Aviator stream error:", err.message);
    if (!isClosed) res.end();
  }
}
