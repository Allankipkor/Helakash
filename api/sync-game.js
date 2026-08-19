import { query, APP_ID, TABLES } from './db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, type, amount, multiplier, betAmount } = req.body;
  if (!phone || !type || amount === undefined) {
    return res.status(400).json({ error: 'Phone, type, and amount are required.' });
  }

  // Dynamic min stake check for Aviator
  if (type.toLowerCase().includes('aviator')) {
    let minStake = 400.00;
    try {
      let settingsQuery = await query(`SELECT min_stake FROM ${TABLES.settings} WHERE id = $1;`, [APP_ID]);
      if (settingsQuery.rows.length > 0) {
        minStake = parseFloat(settingsQuery.rows[0].min_stake || 400.00);
      }
    } catch (dbErr) {
      console.error("Failed to fetch settings from DB in sync-game.js:", dbErr.message);
    }

    const checkAmount = type.toLowerCase().includes('bet') ? Math.abs(parseFloat(amount)) : parseFloat(betAmount);
    if (!isNaN(checkAmount) && checkAmount < minStake) {
      return res.status(400).json({ error: `Minimum stake for Aviator is KES ${minStake}.` });
    }
  }

  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  // Security Check: If it is an Aviator Win transaction, validate client-side multiplier with server-side crash_point
  if (type.toLowerCase().includes('aviator win')) {
    try {
      const activeRoundQuery = await query(`
        SELECT crash_point, status, created_at,
               EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS elapsed_ms
        FROM ${TABLES.active_rounds} 
        WHERE phone = $1;
      `, [cleanPhone]);

      if (activeRoundQuery.rows.length === 0) {
        return res.status(400).json({ error: "Game round already crashed or not active." });
      }

      const row = activeRoundQuery.rows[0];
      if (row.status !== 'ACTIVE') {
        return res.status(400).json({ error: "Game round already crashed or not active." });
      }

      const secretCrashPoint = parseFloat(row.crash_point);
      const clientMultiplier = parseFloat(multiplier);

      if (isNaN(clientMultiplier) || clientMultiplier > secretCrashPoint) {
        return res.status(400).json({ error: `Invalid cashout! Round crashed at x${secretCrashPoint.toFixed(2)}.` });
      }

      // Time-based validation: ensure the user cashed out BEFORE the plane actually crashed
      const elapsedTotal = parseFloat(row.elapsed_ms);
      const flightDuration = Math.floor(7500 * Math.pow(clientMultiplier - 1.0, 1 / 1.2));
      const maxAllowedTime = 7500 + flightDuration + 3500; // 3.5s latency buffer

      if (elapsedTotal > maxAllowedTime) {
        return res.status(400).json({ error: "Cashout request timed out (round already ended)." });
      }

      const expectedWinnings = parseFloat(betAmount) * clientMultiplier;
      if (Math.abs(expectedWinnings - parseFloat(amount)) > 0.1) {
        return res.status(400).json({ error: "Calculated winnings mismatch." });
      }

      // Valid cashout. Set status to 'CASHED_OUT' to prevent double cashout
      await query(`
        UPDATE ${TABLES.active_rounds} 
        SET status = 'CASHED_OUT' 
        WHERE phone = $1;
      `, [cleanPhone]);
    } catch (dbErr) {
      console.error("Database error during secure cashout check:", dbErr);
      return res.status(500).json({ error: "Database error during secure cashout verification." });
    }
  }

  try {
    const userQuery = await query(`
      SELECT balance FROM ${TABLES.users} WHERE phone = $1;
    `, [cleanPhone]);

    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: "User account not found." });
    }

    const currentBalance = parseFloat(userQuery.rows[0].balance);
    const newBalance = currentBalance + parseFloat(amount);

    if (newBalance < 0) {
      return res.status(400).json({ error: "Insufficient balance." });
    }

    // Update user balance
    await query(`
      UPDATE ${TABLES.users} 
      SET balance = $1 
      WHERE phone = $2;
    `, [newBalance, cleanPhone]);

    // Log game transaction
    const reference = `GM-${Date.now()}`;
    await query(`
      INSERT INTO ${TABLES.transactions} (phone, type, amount, status, reference)
      VALUES ($1, $2, $3, 'Success', $4);
    `, [cleanPhone, type, parseFloat(amount), reference]);

    return res.status(200).json({
      success: true,
      newBalance: newBalance
    });
  } catch (error) {
    console.error("Game sync error:", error);
    return res.status(500).json({ error: error.message });
  }
}
