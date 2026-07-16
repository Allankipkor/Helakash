import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, type, amount, multiplier, betAmount } = req.body;
  if (!phone || !type || amount === undefined) {
    return res.status(400).json({ error: 'Phone, type, and amount are required.' });
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
      const activeRoundQuery = await sql`
        SELECT crash_point, status, created_at FROM helakash_active_rounds WHERE phone = ${cleanPhone};
      `;

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
      const roundCreatedAt = new Date(row.created_at).getTime();
      const flightDuration = Math.floor(7500 * Math.pow(clientMultiplier - 1.0, 1 / 1.2));
      const maxAllowedTime = roundCreatedAt + 7500 + flightDuration + 3500; // 3.5s latency buffer

      if (Date.now() > maxAllowedTime) {
        return res.status(400).json({ error: "Cashout request timed out (round already ended)." });
      }

      const expectedWinnings = parseFloat(betAmount) * clientMultiplier;
      if (Math.abs(expectedWinnings - parseFloat(amount)) > 0.1) {
        return res.status(400).json({ error: "Calculated winnings mismatch." });
      }

      // Valid cashout. Set status to 'CASHED_OUT' to prevent double cashout
      await sql`
        UPDATE helakash_active_rounds 
        SET status = 'CASHED_OUT' 
        WHERE phone = ${cleanPhone};
      `;
    } catch (dbErr) {
      console.error("Database error during secure cashout check:", dbErr);
      return res.status(500).json({ error: "Database error during secure cashout verification." });
    }
  }

  try {
    const userQuery = await sql`
      SELECT balance FROM helakash_users WHERE phone = ${cleanPhone};
    `;

    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: "User account not found." });
    }

    const currentBalance = parseFloat(userQuery.rows[0].balance);
    const newBalance = currentBalance + parseFloat(amount);

    if (newBalance < 0) {
      return res.status(400).json({ error: "Insufficient balance." });
    }

    // Update user balance
    await sql`
      UPDATE helakash_users 
      SET balance = ${newBalance} 
      WHERE phone = ${cleanPhone};
    `;

    // Log game transaction
    const reference = `GM-${Date.now()}`;
    await sql`
      INSERT INTO helakash_transactions (phone, type, amount, status, reference)
      VALUES (${cleanPhone}, ${type}, ${amount}, 'Success', ${reference});
    `;

    return res.status(200).json({
      success: true,
      newBalance: newBalance
    });
  } catch (error) {
    console.error("Game sync error:", error);
    return res.status(500).json({ error: error.message });
  }
}
