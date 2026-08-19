import { neon } from '@neondatabase/serverless';

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
export const sql = connectionString ? neon(connectionString, { fullResults: true }) : null;

// Clean and sanitize APP_ID (defaults to 'pawabet')
const rawAppId = process.env.APP_ID || process.env.TABLE_PREFIX || process.env.SITE_ID || 'pawabet';
export const APP_ID = rawAppId.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'pawabet';

// Table names isolated per application / website
export const TABLES = {
  users: `${APP_ID}_users`,
  transactions: `${APP_ID}_transactions`,
  settings: `${APP_ID}_settings`,
  active_rounds: `${APP_ID}_active_rounds`,
  webhook_logs: `${APP_ID}_webhook_logs`,
};

/**
 * Execute a parameterized query with dynamic table names
 * @param {string} text - SQL statement with $1, $2 placeholders
 * @param {Array} params - Parameter values
 * @returns {Promise<any>}
 */
export async function query(text, params = []) {
  if (!sql) {
    throw new Error('Database connection string is missing. Please configure POSTGRES_URL or DATABASE_URL in environment variables.');
  }
  return await sql.query(text, params);
}

/**
 * Initialize all database tables and seed defaults for this specific APP_ID
 */
export async function initAppDatabase() {
  if (!sql) {
    throw new Error('Database connection string is missing.');
  }

  // 1. Users Table
  await query(`
    CREATE TABLE IF NOT EXISTS ${TABLES.users} (
      phone VARCHAR(15) PRIMARY KEY,
      password_hash VARCHAR(255) NOT NULL,
      balance DECIMAL(12, 2) DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`ALTER TABLE ${TABLES.users} ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);`);
  await query(`ALTER TABLE ${TABLES.users} ALTER COLUMN balance SET DEFAULT 0.00;`);

  // 2. Transactions Table
  await query(`
    CREATE TABLE IF NOT EXISTS ${TABLES.transactions} (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(15) REFERENCES ${TABLES.users}(phone),
      type VARCHAR(30) NOT NULL,
      amount DECIMAL(12, 2) NOT NULL,
      status VARCHAR(20) DEFAULT 'PENDING',
      reference VARCHAR(100) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Webhook Logs Table
  await query(`
    CREATE TABLE IF NOT EXISTS ${TABLES.webhook_logs} (
      id SERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Active Rounds Table
  await query(`
    CREATE TABLE IF NOT EXISTS ${TABLES.active_rounds} (
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
    INSERT INTO ${TABLES.active_rounds} (phone, crash_point, crash_point_2, crash_point_3, status)
    VALUES ($1, 1.50, 2.20, 1.30, 'ACTIVE')
    ON CONFLICT (phone) DO NOTHING;
  `, [APP_ID]);

  // 5. Settings Table
  await query(`
    CREATE TABLE IF NOT EXISTS ${TABLES.settings} (
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
    INSERT INTO ${TABLES.settings} (id, min_deposit, min_withdrawal, min_stake, admin_passcode)
    VALUES ($1, 300.00, 500.00, 400.00, 'Aa@123')
    ON CONFLICT (id) DO NOTHING;
  `, [APP_ID]);

  return {
    success: true,
    appId: APP_ID,
    tables: TABLES
  };
}
