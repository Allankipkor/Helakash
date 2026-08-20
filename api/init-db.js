import { initAppDatabase, getAppId, getTables } from './db.js';

export default async function handler(req, res) {
  try {
    const result = await initAppDatabase(req);
    return res.status(200).json({
      success: true,
      message: `Database initialized successfully for ${result.appId}`,
      appId: result.appId,
      tables: result.tables
    });
  } catch (error) {
    console.error("Database initialization failed:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
