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
      payhero_username VARCHAR(255),
      payhero_password VARCHAR(255),
      payhero_channel_id VARCHAR(255),
      payhero_callback_url VARCHAR(255),
      admin_passcode VARCHAR(255) DEFAULT 'Aa@123'
    );
  `);

  // Seed default settings row for this APP_ID
  await query(`
    INSERT INTO ${tables.settings} (id, min_deposit, min_withdrawal, min_stake, admin_passcode)
    VALUES ($1, 300.00, 500.00, 400.00, 'Aa@123')
    ON CONFLICT (id) DO NOTHING;
  `, [appId]);

  return {
    success: true,
    appId: appId,
    tables: tables
  };
}
