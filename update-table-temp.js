const { neon } = require('@neondatabase/serverless');
const fs = require('fs');

// Load environment variables from .env if present
if (fs.existsSync('.env')) {
  const envText = fs.readFileSync('.env', 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("Error: No database connection URL found in environment or .env file.");
  process.exit(1);
}

const sql = neon(dbUrl, { fullResults: true });

async function createTable() {
  try {
    console.log("Creating helakash_settings table if not exists...");
    await sql`
      CREATE TABLE IF NOT EXISTS helakash_settings (
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
        admin_passcode VARCHAR(255) DEFAULT 'admin123'
      );
    `;
    
    console.log("Seeding default settings row if missing...");
    await sql`
      INSERT INTO helakash_settings (id, min_deposit, min_withdrawal, min_stake, admin_passcode)
      VALUES ('global', 300.00, 500.00, 400.00, 'admin123')
      ON CONFLICT (id) DO NOTHING;
    `;
    console.log("Settings table setup successfully!");
  } catch (err) {
    console.error("Error setting up table:", err);
  }
}

createTable();
