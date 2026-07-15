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
    console.log("Dropping and recreating helakash_active_rounds table with three crash points and status...");
    await sql`DROP TABLE IF EXISTS helakash_active_rounds;`;
    await sql`
      CREATE TABLE helakash_active_rounds (
        phone VARCHAR(15) PRIMARY KEY,
        crash_point DECIMAL(12, 2) NOT NULL,
        crash_point_2 DECIMAL(12, 2) NOT NULL,
        crash_point_3 DECIMAL(12, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("Table recreated successfully!");
  } catch (err) {
    console.error("Error creating table:", err);
  }
}

createTable();
