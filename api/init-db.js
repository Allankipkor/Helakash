import { initAppDatabase, APP_ID, TABLES } from './db.js';

export default async function handler(req, res) {
  try {
    const result = await initAppDatabase();
    return res.status(200).json({
      success: true,
      message: `Database tables for app '${APP_ID}' initialized successfully`,
      appId: APP_ID,
      tables: TABLES,
      details: result
    });
  } catch (error) {
    console.error("Database initialization error:", error);
    return res.status(500).json({ error: error.message });
  }
}
