import { neon } from '@neondatabase/serverless';

const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.warn("WARNING: Neither POSTGRES_URL nor DATABASE_URL is defined.");
}

export const sql = neon(dbUrl, { fullResults: true });

// Normalize APP_ID (alphanumeric and underscores only, lowercase)
// Defaults to 'helakash' if APP_ID environment variable is not set
export const APP_ID = (process.env.APP_ID || 'helakash').toLowerCase().replace(/[^a-z0-9_]/g, '');

// Pre-constructed safe identifier expressions for use in tagged templates:
// Example: await sql`SELECT * FROM ${TABLES.USERS} WHERE phone = ${phone};`
export const TABLES = {
  USERS: sql.unsafe(`${APP_ID}_users`),
  TRANSACTIONS: sql.unsafe(`${APP_ID}_transactions`),
  SETTINGS: sql.unsafe(`${APP_ID}_settings`),
  ACTIVE_ROUNDS: sql.unsafe(`${APP_ID}_active_rounds`),
  WEBHOOK_LOGS: sql.unsafe(`${APP_ID}_webhook_logs`),
};

// Plain string table names for reference or DDL
export const TABLE_NAMES = {
  USERS: `${APP_ID}_users`,
  TRANSACTIONS: `${APP_ID}_transactions`,
  SETTINGS: `${APP_ID}_settings`,
  ACTIVE_ROUNDS: `${APP_ID}_active_rounds`,
  WEBHOOK_LOGS: `${APP_ID}_webhook_logs`,
};
