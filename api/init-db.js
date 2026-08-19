import { sql, TABLES, TABLE_NAMES, APP_ID } from './db.js';

export default async function handler(req, res) {
  try {
    // 1. Create ${APP_ID}_users table if not exists with starting balance of 0.00 KES
    await sql`
      CREATE TABLE IF NOT EXISTS ${TABLES.USERS} (
        phone VARCHAR(15) PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        balance DECIMAL(12, 2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Migration in case table already exists:
    await sql`
      ALTER TABLE ${TABLES.USERS} ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
    `;
    await sql`
      ALTER TABLE ${TABLES.USERS} ALTER COLUMN balance SET DEFAULT 0.00;
    `;

    // 2. Create ${APP_ID}_transactions table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS ${TABLES.TRANSACTIONS} (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(15) REFERENCES ${TABLES.USERS}(phone),
        type VARCHAR(30) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'PENDING',
        reference VARCHAR(100) UNIQUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Ensure TIMESTAMPTZ migration for existing tables
    try {
      await sql`
        ALTER TABLE ${TABLES.TRANSACTIONS} ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
      `;
    } catch (migErr) {
      console.log("Migration notice for created_at:", migErr.message);
    }

    // 3. Create ${APP_ID}_webhook_logs table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS ${TABLES.WEBHOOK_LOGS} (
        id SERIAL PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 4. Create ${APP_ID}_active_rounds table with columns for 3 upcoming crash points and status
    await sql`
      CREATE TABLE IF NOT EXISTS ${TABLES.ACTIVE_ROUNDS} (
        phone VARCHAR(15) PRIMARY KEY,
        crash_point DECIMAL(12, 2) NOT NULL,
        crash_point_2 DECIMAL(12, 2) NOT NULL,
        crash_point_3 DECIMAL(12, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Insert default 'global' active round
    await sql`
      INSERT INTO ${TABLES.ACTIVE_ROUNDS} (phone, crash_point, crash_point_2, crash_point_3, status)
      VALUES ('global', 1.50, 2.20, 1.30, 'ACTIVE')
      ON CONFLICT (phone) DO NOTHING;
    `;

    // 5. Create ${APP_ID}_settings table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS ${TABLES.SETTINGS} (
        id VARCHAR(30) PRIMARY KEY,
        min_deposit DECIMAL(12, 2) DEFAULT 300.00,
        min_withdrawal DECIMAL(12, 2) DEFAULT 500.00,
        min_stake DECIMAL(12, 2) DEFAULT 400.00,
        payhero_username VARCHAR(255),
        payhero_password VARCHAR(255),
        payhero_channel_id VARCHAR(255),
        payhero_callback_url VARCHAR(255),
        paystack_secret_key VARCHAR(255),
        paystack_public_key VARCHAR(255),
        admin_passcode VARCHAR(255) DEFAULT 'Aa@123'
      );
    `;

    // Seed default settings row if missing
    await sql`
      INSERT INTO ${TABLES.SETTINGS} (id, min_deposit, min_withdrawal, min_stake, admin_passcode)
      VALUES ('global', 300.00, 500.00, 400.00, 'Aa@123')
      ON CONFLICT (id) DO NOTHING;
    `;

    return res.status(200).json({ 
      success: true, 
      message: `Database tables and settings for app '${APP_ID}' initialized successfully`,
      app_id: APP_ID,
      tables: TABLE_NAMES
    });
  } catch (error) {
    console.error("Database initialization error:", error);
    return res.status(500).json({ error: error.message });
  }
}
