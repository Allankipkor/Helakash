import { query, getAppId, getTables, normalizePhoneVariants, ensureUser, findUserOrImport } from './db.js';

export default async function handler(req, res) {
  const tables = getTables(req);
  const appId = getAppId(req);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phone, betAmount, cashoutMultiplier, multiplier, winAmount: customWinAmount, type, amount, crashed } = req.body || {};

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(phone);

  try {
    // 1. Ensure user exists or import from sister tables
    let user = await findUserOrImport(phone, tables);
    if (!user) {
      user = await ensureUser(phone, tables);
    }

    let currentBalance = parseFloat(user.balance || 0.00);
    const userPhone = user.phone || primary;

    // Handle Deposit Sync (e.g. from simulated deposits or client recovery)
    if (type === 'Deposit' && (amount || betAmount)) {
      const depositAmt = parseFloat(amount || betAmount);
      if (!isNaN(depositAmt) && depositAmt > 0) {
        const updateRes = await query(`
          UPDATE ${tables.users}
          SET balance = ROUND(balance + $1, 2)
          WHERE phone = $2 OR phone = $3 OR phone = $4
          RETURNING balance, phone;
        `, [depositAmt, phone254, phone0, phoneShort]);

        const newBal = updateRes.rows.length > 0 ? parseFloat(updateRes.rows[0].balance) : currentBalance + depositAmt;
        const ref = `DEP-${appId.toUpperCase()}-${Date.now()}`;

        await query(`
          INSERT INTO ${tables.transactions} (phone, type, amount, status, reference)
          VALUES ($1, 'Deposit', $2, 'Success', $3);
        `, [userPhone, depositAmt, ref]);

        return res.status(200).json({
          success: true,
          action: 'deposit_synced',
          amount: depositAmt,
          newBalance: newBal,
          balance: newBal
        });
      }
    }

    // Handle Bet Placement (Deduct balance)
    const isBetPlacement = (betAmount !== undefined || amount !== undefined) && 
                           !cashoutMultiplier && !multiplier && !crashed && 
                           (!type || type.toLowerCase().includes('bet'));

    if (isBetPlacement) {
      const bet = parseFloat(betAmount !== undefined ? betAmount : amount);
      if (isNaN(bet) || bet <= 0) {
        return res.status(400).json({ error: 'Invalid bet amount.' });
      }

      // Check min stake setting
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
        console.warn("Failed to fetch min_stake from DB:", dbErr.message);
      }

      if (bet < minStake) {
        return res.status(400).json({ error: `Minimum stake amount is KES ${minStake}.` });
      }

      if (currentBalance < bet) {
        return res.status(400).json({ error: 'Insufficient balance to place bet.' });
      }

      const updated = await query(`
        UPDATE ${tables.users} 
        SET balance = ROUND(balance - $1, 2) 
        WHERE phone = $2 OR phone = $3 OR phone = $4 
        RETURNING balance, phone;
      `, [bet, phone254, phone0, phoneShort]);

      const newBal = parseFloat(updated.rows[0].balance);
      const gameType = (type && type.toLowerCase().includes('mines')) ? 'Mines Bet' : 'Aviator Bet';
      const ref = `BET-${appId.toUpperCase()}-${Date.now()}`;

      await query(`
        INSERT INTO ${tables.transactions} (phone, type, amount, status, reference)
        VALUES ($1, $2, $3, 'Completed', $4);
      `, [userPhone, gameType, -bet, ref]);

      return res.status(200).json({
        success: true,
        action: 'bet_placed',
        newBalance: newBal,
        balance: newBal
      });
    }

    // Handle Cashout / Win (Aviator or Mines Win)
    const activeMultiplier = cashoutMultiplier !== undefined ? cashoutMultiplier : multiplier;
    const isWin = activeMultiplier !== undefined || (type && type.toLowerCase().includes('win')) || customWinAmount !== undefined;

    if (isWin) {
      let winAmt = 0;
      const mult = activeMultiplier ? parseFloat(activeMultiplier) : 1.0;
      const rawBet = betAmount !== undefined ? parseFloat(betAmount) : (amount !== undefined ? parseFloat(amount) : 0);

      if (customWinAmount !== undefined && !isNaN(parseFloat(customWinAmount))) {
        winAmt = parseFloat(parseFloat(customWinAmount).toFixed(2));
      } else if (rawBet > 0 && mult > 0) {
        winAmt = parseFloat((rawBet * mult).toFixed(2));
      } else if (amount !== undefined && parseFloat(amount) > 0) {
        winAmt = parseFloat(parseFloat(amount).toFixed(2));
      }

      if (winAmt <= 0) {
        return res.status(400).json({ error: 'Invalid win amount calculation.' });
      }

      const updated = await query(`
        UPDATE ${tables.users} 
        SET balance = ROUND(balance + $1, 2) 
        WHERE phone = $2 OR phone = $3 OR phone = $4 
        RETURNING balance, phone;
      `, [winAmt, phone254, phone0, phoneShort]);

      const newBal = parseFloat(updated.rows[0].balance);
      const winType = type || ((type && type.includes('Mines')) ? 'Mines Win' : 'Aviator Win');
      const ref = `WIN-${appId.toUpperCase()}-${Date.now()}`;

      await query(`
        INSERT INTO ${tables.transactions} (phone, type, amount, status, reference)
        VALUES ($1, $2, $3, 'Success', $4);
      `, [userPhone, winType, winAmt, ref]);

      return res.status(200).json({
        success: true,
        action: 'cashed_out',
        winAmount: winAmt,
        newBalance: newBal,
        balance: newBal
      });
    }

    // Default balance inquiry
    return res.status(200).json({
      success: true,
      balance: currentBalance,
      newBalance: currentBalance
    });

  } catch (error) {
    console.error("sync-game API error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
