import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    // Create users table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        phone VARCHAR(15) PRIMARY KEY,
        balance DECIMAL(12, 2) DEFAULT 500.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Create transactions table
    await sql`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(15) REFERENCES users(phone),
        type VARCHAR(30) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'PENDING',
        reference VARCHAR(100) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    return res.status(200).json({ success: true, message: "Database tables initialized successfully" });
  } catch (error) {
    console.error("Database initialization error:", error);
    return res.status(500).json({ error: error.message });
  }
}
