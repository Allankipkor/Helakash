import { query, getAppId, getTables } from './db.js';

export default async function handler(req, res) {
  const tables = getTables(req);
  const appId = getAppId(req);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, betAmount, cashoutMultiplier, crashed } = req.body;

  let cleanPhone = phone ? phone.replace(/\D/g, '') : '';
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  } else if (cleanPhone.startsWith('7') || cleanPhone.startsWith('1')) {
    cleanPhone = '254' + cleanPhone;
  }

  if (betAmount !== undefined) {
    let minStake = 400.00;
    try {
      let settingsQuery = await query(`SELECT min_stake FROM ${tables.settings} WHERE id = $1;`, [appId]);
      if (settingsQuery.rows.length === 0) {
        settingsQuery = await query(`SELECT min_stake FROM ${tables.settings} LIMIT 1;`);
      }
      if (settingsQuery.rows.length > 0) {
        minStake = parseFloat(settingsQuery.rows[0].min_stake || 400.00);
      }
    } catch (dbErr) {
      console.error("Failed to fetch min_stake from DB:", dbErr.message);
    }

    if (parseFloat(betAmount) < minStake) {
      return res.status(400).json({ error: `Minimum stake amount is KES ${minStake}.` });
    }
  }

  try {
    let balance = 0.00;
    if (cleanPhone) {
      const userRes = await query(`
        SELECT balance FROM ${tables.users} 
        WHERE phone = $1;
      `, [cleanPhone]);

      if (userRes.rows.length > 0) {
        balance = parseFloat(userRes.rows[0].balance);
      }
    }

    if (betAmount !== undefined && !cashoutMultiplier && !crashed) {
      const bet = parseFloat(betAmount);
      if (balance < bet) {
        return res.status(400).json({ error: 'Insufficient balance to place bet.' });
      }

      const updated = await query(`
        UPDATE ${tables.users} 
        SET balance = balance - $1 
        WHERE phone = $2 
        RETURNING balance;
      `, [bet, cleanPhone]);

      return res.status(200).json({
        success: true,
        action: 'bet_placed',
        newBalance: parseFloat(updated.rows[0].balance)
      });
    }

    if (cashoutMultiplier !== undefined && betAmount !== undefined) {
      const mult = parseFloat(cashoutMultiplier);
      const bet = parseFloat(betAmount);

      const activeRound = await query(`
        SELECT crash_point, status FROM ${tables.active_rounds} 
        WHERE phone = $1;
      `, [cleanPhone]);

      if (activeRound.rows.length === 0 || activeRound.rows[0].status !== 'ACTIVE') {
        return res.status(400).json({ error: 'No active round found or plane has already crashed.' });
      }

      const actualCrashPoint = parseFloat(activeRound.rows[0].crash_point);
      if (mult > actualCrashPoint) {
        return res.status(400).json({ error: 'Cashout multiplier exceeds crash point.' });
      }

      const winAmount = parseFloat((bet * mult).toFixed(2));

      const updated = await query(`
        UPDATE ${tables.users} 
        SET balance = balance + $1 
        WHERE phone = $2 
        RETURNING balance;
      `, [winAmount, cleanPhone]);

      const ref = `WIN-${appId.toUpperCase()}-${Date.now()}`;
      await query(`
        INSERT INTO ${tables.transactions} (phone, type, amount, status, reference)
        VALUES ($1, 'Aviator Win', $2, 'Success', $3);
      `, [cleanPhone, winAmount, ref]);

      return res.status(200).json({
        success: true,
        action: 'cashed_out',
        winAmount: winAmount,
        newBalance: parseFloat(updated.rows[0].balance)
      });
    }

    return res.status(200).json({ success: true, balance: balance });
  } catch (error) {
    console.error("sync-game error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
