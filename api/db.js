import { neon } from '@neondatabase/serverless';

let _sql = null;

export function getSql() {
  const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!_sql && databaseUrl) {
    _sql = neon(databaseUrl);
  }
  return _sql;
}

export const sql = getSql();

/**
 * Dynamically determines the active application ID.
 * Priority:
 * 1. process.env.APP_ID / TABLE_PREFIX / SITE_ID
 * 2. Host header from incoming request (e.g. patapesa.com -> patapesa)
 * 3. Fallback default 'pawabet'
 * @param {object} [req] - Incoming HTTP request
 * @returns {string}
 */
export function getAppId(req) {
  if (process.env.APP_ID) {
    return process.env.APP_ID.toLowerCase().replace(/[^a-z0-9_]/g, '');
  }
  if (process.env.TABLE_PREFIX) {
    return process.env.TABLE_PREFIX.toLowerCase().replace(/[^a-z0-9_]/g, '');
  }
  if (process.env.SITE_ID) {
    return process.env.SITE_ID.toLowerCase().replace(/[^a-z0-9_]/g, '');
  }
  
  if (req && req.headers && req.headers.host) {
    const host = req.headers.host.toLowerCase();
    const knownSites = ['luckywin', 'helakash', 'patapesa', 'shindamax', 'pawabet', 'statpesa', 'pesakash', 'patpesa', 'kwetubet'];
    for (const site of knownSites) {
      if (host.includes(site)) {
        return site;
      }
    }
    const cleanHost = host.split(':')[0].split('.')[0].replace(/[^a-z0-9_]/g, '');
    if (cleanHost && cleanHost !== 'localhost' && cleanHost !== '127') {
      return cleanHost;
    }
  }

  return 'pawabet';
}

/**
 * Get isolated table names for the request
 * @param {object} [req]
 */
export function getTables(req) {
  const appId = getAppId(req);
  return {
    users: `${appId}_users`,
    transactions: `${appId}_transactions`,
    settings: `${appId}_settings`,
    active_rounds: `${appId}_active_rounds`,
    webhook_logs: `${appId}_webhook_logs`,
  };
}

export const APP_ID = getAppId();
export const TABLES = getTables();

/**
 * Normalizes any Kenyan phone number format into all 3 common variants:
 * - phone254 (e.g. '254712345678')
 * - phone0 (e.g. '0712345678')
 * - phoneShort (e.g. '712345678')
 * @param {string|number} phone 
 * @returns {{ phone254: string, phone0: string, phoneShort: string, variants: [string, string, string], primary: string }}
 */
export function normalizePhoneVariants(phone) {
  if (!phone) {
    return { phone254: '', phone0: '', phoneShort: '', variants: ['', '', ''], primary: '' };
  }
  
  const rawDigits = String(phone).replace(/\D/g, '');
  let suffix = rawDigits;

  if (rawDigits.startsWith('254') && rawDigits.length >= 12) {
    suffix = rawDigits.slice(3);
  } else if (rawDigits.startsWith('0') && rawDigits.length >= 10) {
    suffix = rawDigits.slice(1);
  } else if (rawDigits.length === 9) {
    suffix = rawDigits;
  }

  let phone254, phone0, phoneShort;
  if (suffix.length === 9) {
    phone254 = '254' + suffix;
    phone0 = '0' + suffix;
    phoneShort = suffix;
  } else {
    // Fallback if not standard 9-digit format
    phone254 = rawDigits.startsWith('254') ? rawDigits : (rawDigits.startsWith('0') ? '254' + rawDigits.slice(1) : rawDigits);
    phone0 = rawDigits.startsWith('0') ? rawDigits : (rawDigits.startsWith('254') ? '0' + rawDigits.slice(3) : '0' + rawDigits);
    phoneShort = suffix;
  }

  return {
    phone254,
    phone0,
    phoneShort,
    variants: [phone254, phone0, phoneShort],
    primary: phone254
  };
}

export const SISTER_TABLES = [
  'statpesa_users',
  'shindamax_users',
  'patapesa_users',
  'luckywin_users',
  'helakash_users',
  'kwetubet_users',
  'pawabet_users',
  'pesakash_users',
  'users'
];

/**
 * Execute a parameterized query with dynamic table names, normalized to always return { rows: [...] }
 * @param {string} text - SQL statement with $1, $2 placeholders
 * @param {Array} params - Parameter values
 * @returns {Promise<{ rows: Array<any> }>}
 */
export async function query(text, params = []) {
  const client = getSql();
  if (!client) {
    throw new Error('Database connection string is missing. Please configure POSTGRES_URL or DATABASE_URL in environment variables.');
  }
  const result = await client.query(text, params);
  
  if (Array.isArray(result)) {
    return { rows: result };
  }
  if (result && Array.isArray(result.rows)) {
    return result;
  }
  return { rows: result ? [result] : [] };
}

/**
 * Find user across all 3 phone formats in target table. If missing, look in sister tables and import.
 * @param {string} phone
 * @param {object} tables
 * @returns {Promise<object|null>}
 */
export async function findUserOrImport(phone, tables) {
  const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(phone);
  if (!primary && !phone) return null;

  const targetTable = tables.users;

  // 1. Check current app table with all 3 variants
  try {
    const userRes = await query(`
      SELECT phone, password_hash, balance, created_at
      FROM ${targetTable}
      WHERE phone = $1 OR phone = $2 OR phone = $3
      LIMIT 1;
    `, [phone254, phone0, phoneShort]);

    if (userRes.rows.length > 0) {
      return userRes.rows[0];
    }
  } catch (err) {
    console.warn(`Query failed on ${targetTable}:`, err.message);
  }

  // 2. Not in current table -> Check sister tables
  for (const sisterTable of SISTER_TABLES) {
    if (sisterTable === targetTable) continue;
    try {
      const sisterRes = await query(`
        SELECT phone, password_hash, balance, created_at
        FROM ${sisterTable}
        WHERE phone = $1 OR phone = $2 OR phone = $3
        LIMIT 1;
      `, [phone254, phone0, phoneShort]);

      if (sisterRes.rows.length > 0) {
        const found = sisterRes.rows[0];
        const existingBalance = parseFloat(found.balance || 0.00);
        const existingPwd = found.password_hash || 'NO_PASSWORD_MIGRATED';
        const importedPhone = found.phone || primary;

        // Import into current app's users table
        const insertRes = await query(`
          INSERT INTO ${targetTable} (phone, password_hash, balance, created_at)
          VALUES ($1, $2, $3, COALESCE($4, CURRENT_TIMESTAMP))
          ON CONFLICT (phone) DO UPDATE
          SET balance = ${targetTable}.balance + EXCLUDED.balance,
              password_hash = COALESCE(NULLIF(${targetTable}.password_hash, 'NO_PASSWORD_MIGRATED'), EXCLUDED.password_hash)
          RETURNING phone, password_hash, balance, created_at;
        `, [importedPhone, existingPwd, existingBalance, found.created_at || null]);

        console.log(`[Sister Table Import] Imported user ${importedPhone} from ${sisterTable} into ${targetTable} with balance KES ${existingBalance}`);
        return insertRes.rows[0] || { phone: importedPhone, password_hash: existingPwd, balance: existingBalance, created_at: found.created_at };
      }
    } catch (_) {
      // Table may not exist in database; silently skip
    }
  }

  return null;
}

/**
 * Ensure user exists in target table, importing from sister tables or provisioning a new record.
 * @param {string} phone
 * @param {object} tables
 * @returns {Promise<object>}
 */
export async function ensureUser(phone, tables) {
  const found = await findUserOrImport(phone, tables);
  if (found) return found;

  const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(phone);
  const targetTable = tables.users;

  await query(`
    INSERT INTO ${targetTable} (phone, balance, password_hash)
    VALUES ($1, 0.00, 'NO_PASSWORD_MIGRATED')
    ON CONFLICT (phone) DO NOTHING;
  `, [primary || phone254]);

  const fresh = await query(`
    SELECT phone, password_hash, balance, created_at
    FROM ${targetTable}
    WHERE phone = $1 OR phone = $2 OR phone = $3
    LIMIT 1;
  `, [phone254, phone0, phoneShort]);

  return fresh.rows[0] || { phone: primary || phone254, balance: 0.00, password_hash: 'NO_PASSWORD_MIGRATED', created_at: new Date() };
}

/**
 * Initialize all database tables and seed defaults for this specific APP_ID
 * @param {object} [req]
 */
export async function initAppDatabase(req) {
  const client = getSql();
  if (!client) {
    throw new Error('Database connection string is missing.');
  }

  const appId = getAppId(req);
  const tables = getTables(req);

  // 1. Users Table
  await query(`
    CREATE TABLE IF NOT EXISTS ${tables.users} (
      phone VARCHAR(15) PRIMARY KEY,
      password_hash VARCHAR(255) NOT NULL,
      balance DECIMAL(12, 2) DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Transactions Table
  await query(`
    CREATE TABLE IF NOT EXISTS ${tables.transactions} (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(15) REFERENCES ${tables.users}(phone),
      type VARCHAR(30) NOT NULL,
      amount DECIMAL(12, 2) NOT NULL,
      status VARCHAR(20) DEFAULT 'PENDING',
      reference VARCHAR(100) UNIQUE,
      checkout_request_id VARCHAR(255),
      gateway_tx_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Webhook Logs Table
  await query(`
    CREATE TABLE IF NOT EXISTS ${tables.webhook_logs} (
      id SERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Active Rounds Table
  await query(`
    CREATE TABLE IF NOT EXISTS ${tables.active_rounds} (
      phone VARCHAR(30) PRIMARY KEY,
      crash_point DECIMAL(12, 2) NOT NULL,
      crash_point_2 DECIMAL(12, 2) NOT NULL,
      crash_point_3 DECIMAL(12, 2) NOT NULL,
      status VARCHAR(20) DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default active rounds for APP_ID
  await query(`
    INSERT INTO ${tables.active_rounds} (phone, crash_point, crash_point_2, crash_point_3, status)
    VALUES ($1, 1.50, 2.20, 1.30, 'ACTIVE')
    ON CONFLICT (phone) DO NOTHING;
  `, [appId]);

  // 5. Settings Table
  await query(`
    CREATE TABLE IF NOT EXISTS ${tables.settings} (
      id VARCHAR(50) PRIMARY KEY,
      min_deposit DECIMAL(12, 2) DEFAULT 300.00,
      min_withdrawal DECIMAL(12, 2) DEFAULT 500.00,
      min_stake DECIMAL(12, 2) DEFAULT 400.00,
      active_gateway VARCHAR(50) DEFAULT 'payhero',
      payhero_username VARCHAR(255),
      payhero_password VARCHAR(255),
      payhero_channel_id VARCHAR(255),
      payhero_callback_url VARCHAR(255),
      tinypesa_api_key VARCHAR(255),
      tinypesa_account_no VARCHAR(255),
      gravitypay_api_key VARCHAR(255),
      gravitypay_secret_key VARCHAR(255),
      gravitypay_webhook_secret VARCHAR(255),
      aviator_speed VARCHAR(50) DEFAULT 'normal',
      admin_passcode VARCHAR(255) DEFAULT 'Aa@123'
    );
  `);

  // Ensure columns exist on already created settings & transactions tables
  try {
    await query(`ALTER TABLE ${tables.settings} ADD COLUMN IF NOT EXISTS active_gateway VARCHAR(50) DEFAULT 'payhero';`);
    await query(`ALTER TABLE ${tables.settings} ADD COLUMN IF NOT EXISTS tinypesa_api_key VARCHAR(255);`);
    await query(`ALTER TABLE ${tables.settings} ADD COLUMN IF NOT EXISTS tinypesa_account_no VARCHAR(255);`);
    await query(`ALTER TABLE ${tables.settings} ADD COLUMN IF NOT EXISTS gravitypay_api_key VARCHAR(255);`);
    await query(`ALTER TABLE ${tables.settings} ADD COLUMN IF NOT EXISTS gravitypay_secret_key VARCHAR(255);`);
    await query(`ALTER TABLE ${tables.settings} ADD COLUMN IF NOT EXISTS gravitypay_webhook_secret VARCHAR(255);`);
    await query(`ALTER TABLE ${tables.settings} ADD COLUMN IF NOT EXISTS aviator_speed VARCHAR(50) DEFAULT 'normal';`);
    await query(`ALTER TABLE ${tables.transactions} ADD COLUMN IF NOT EXISTS checkout_request_id VARCHAR(255);`);
    await query(`ALTER TABLE ${tables.transactions} ADD COLUMN IF NOT EXISTS gateway_tx_id VARCHAR(255);`);
  } catch (_) {}

  // Seed default settings row for this APP_ID
  await query(`
    INSERT INTO ${tables.settings} (id, min_deposit, min_withdrawal, min_stake, active_gateway, aviator_speed, admin_passcode)
    VALUES ($1, 300.00, 500.00, 400.00, 'payhero', 'normal', 'Aa@123')
    ON CONFLICT (id) DO NOTHING;
  `, [appId]);

  return {
    success: true,
    appId: appId,
    tables: tables
  };
}

/**
 * Get curve divisor and exponent for a speed preset
 */
export function getSpeedCurveParams(speed) {
  switch (String(speed || '').toLowerCase().trim()) {
    case 'slow':
      return { speed: 'slow', divisor: 7000, exponent: 1.90 };
    case 'fast':
      return { speed: 'fast', divisor: 4000, exponent: 1.65 };
    case 'turbo':
      return { speed: 'turbo', divisor: 3000, exponent: 1.50 };
    case 'normal':
    default:
      return { speed: 'normal', divisor: 5500, exponent: 1.88 };
  }
}

/**
 * Generates a realistic Aviator crash point multiplier
 */
export function generateCrashPoint() {
  const instantCrash = Math.random() < 0.02; // 2% instant crash
  if (instantCrash) return 1.00;
  let point = Math.max(1.01, 0.98 / Math.random());
  if (point > 80.00) point = 80.00;
  return parseFloat(point.toFixed(2));
}

/**
 * Authoritative global active round reader & state engine.
 * Ensures ALL connected devices, game streams, and predictor instances share the EXACT same round state.
 */
export async function getOrAdvanceGlobalActiveRound(appId, tables) {
  // 1. Fetch current speed setting for this app
  let speedSetting = 'normal';
  try {
    const speedQuery = await query(`SELECT aviator_speed FROM ${tables.settings} WHERE id = $1;`, [appId]);
    if (speedQuery.rows.length > 0 && speedQuery.rows[0].aviator_speed) {
      speedSetting = speedQuery.rows[0].aviator_speed;
    }
  } catch (_) {}
  const speedParams = getSpeedCurveParams(speedSetting);

  // 2. Fetch master active round record for appId
  let globalQuery = await query(`
    SELECT crash_point, crash_point_2, crash_point_3, created_at,
           EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS elapsed_ms
    FROM ${tables.active_rounds} 
    WHERE phone = $1;
  `, [appId]);

  if (globalQuery.rows.length === 0) {
    const cp1 = generateCrashPoint();
    const cp2 = generateCrashPoint();
    const cp3 = generateCrashPoint();
    await query(`
      INSERT INTO ${tables.active_rounds} (phone, crash_point, crash_point_2, crash_point_3, status, created_at)
      VALUES ($1, $2, $3, $4, 'ACTIVE', NOW())
      ON CONFLICT (phone) DO NOTHING;
    `, [appId, cp1, cp2, cp3]);

    globalQuery = await query(`
      SELECT crash_point, crash_point_2, crash_point_3, created_at,
             EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS elapsed_ms
      FROM ${tables.active_rounds} 
      WHERE phone = $1;
    `, [appId]);
  }

  let row = globalQuery.rows[0] || { crash_point: 1.50, crash_point_2: 2.20, crash_point_3: 1.30, elapsed_ms: 0, created_at: new Date() };
  let crashPoint = parseFloat(row.crash_point || 1.50);
  let crashPoint2 = parseFloat(row.crash_point_2 || 2.20);
  let crashPoint3 = parseFloat(row.crash_point_3 || 1.30);
  let elapsedMs = Math.max(0, parseFloat(row.elapsed_ms || 0));

  const countdownDuration = 7500;
  const postCrashDuration = 3000;
  let flightDurationLimit = Math.floor(speedParams.divisor * Math.pow(Math.max(0.01, crashPoint - 1.0), 1 / speedParams.exponent));
  let totalRoundDuration = countdownDuration + flightDurationLimit + postCrashDuration;

  // 3. Shift round if current round duration has elapsed
  if (elapsedMs >= totalRoundDuration) {
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

    // Re-fetch updated active round
    const reQuery = await query(`
      SELECT crash_point, crash_point_2, crash_point_3, created_at,
             EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS elapsed_ms
      FROM ${tables.active_rounds} 
      WHERE phone = $1;
    `, [appId]);

    if (reQuery.rows.length > 0) {
      row = reQuery.rows[0];
      crashPoint = parseFloat(row.crash_point || 1.50);
      crashPoint2 = parseFloat(row.crash_point_2 || 2.20);
      crashPoint3 = parseFloat(row.crash_point_3 || 1.30);
      elapsedMs = Math.max(0, parseFloat(row.elapsed_ms || 0));
      flightDurationLimit = Math.floor(speedParams.divisor * Math.pow(Math.max(0.01, crashPoint - 1.0), 1 / speedParams.exponent));
      totalRoundDuration = countdownDuration + flightDurationLimit + postCrashDuration;
    }
  }

  // 4. Calculate Phase and Multiplier
  let phase = 'waiting';
  let remainingMs = 0;
  let elapsedFlight = 0;
  let currentMultiplier = 1.00;

  if (elapsedMs < countdownDuration) {
    phase = 'waiting';
    remainingMs = Math.max(0, countdownDuration - elapsedMs);
  } else if (elapsedMs < countdownDuration + flightDurationLimit) {
    phase = 'flying';
    elapsedFlight = elapsedMs - countdownDuration;
    currentMultiplier = parseFloat((1.0 + Math.pow(elapsedFlight / speedParams.divisor, speedParams.exponent)).toFixed(2));
    if (currentMultiplier >= crashPoint) currentMultiplier = crashPoint;
    remainingMs = Math.max(0, (countdownDuration + flightDurationLimit) - elapsedMs);
  } else {
    phase = 'crashed';
    elapsedFlight = flightDurationLimit;
    currentMultiplier = crashPoint;
    remainingMs = Math.max(0, totalRoundDuration - elapsedMs);
  }

  return {
    appId,
    crashPoint,
    crashPoint2,
    crashPoint3,
    speedSetting,
    speedParams,
    flightDurationLimit,
    countdownDuration,
    postCrashDuration,
    totalRoundDuration,
    elapsedMs,
    createdAt: row.created_at,
    phase,
    remainingMs,
    elapsedFlight,
    currentMultiplier
  };
}
