import { query, getTables, getAppId, normalizePhoneVariants, findUserOrImport, ensureUser } from './db.js';

export default async function handler(req, res) {
  const appId = getAppId(req);
  const tables = getTables(req);

  // Allow POST or GET for verification flexibility
  const reference = req.query.reference || (req.body && req.body.reference);
  const status = req.query.status || (req.body && req.body.status); // Used for simulated transactions

  if (!reference) {
    return res.status(400).json({ error: 'Transaction reference is required.' });
  }

  const cleanEnvVar = (val) => {
    if (!val) return val;
    let clean = val.trim();
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
      clean = clean.slice(1, -1);
    }
    return clean.trim();
  };

  let secretKey = cleanEnvVar(process.env.PAYSTACK_SECRET_KEY);

  try {
    const settingsQuery = await query(`SELECT paystack_secret_key FROM ${tables.settings} WHERE id = $1;`, [appId]);
    if (settingsQuery.rows.length > 0) {
      const dbSettings = settingsQuery.rows[0];
      if (dbSettings.paystack_secret_key) secretKey = dbSettings.paystack_secret_key;
    }
  } catch (dbErr) {
    console.error("Error reading settings in paystack-verify.js:", dbErr);
  }

  // Check if simulated reference
  const isSimulated = reference.startsWith('PS-SIM-');

  try {
    // 1. Fetch current transaction details
    const txQuery = await query(`
      SELECT phone, amount, status FROM ${tables.transactions} 
      WHERE reference = $1;
    `, [reference]);

    if (txQuery.rows.length === 0) {
      return res.status(404).json({ error: `Transaction ${reference} not found in database.` });
    }

    const tx = txQuery.rows[0];
    const rawPhone = tx.phone;
    const amount = parseFloat(tx.amount);
    const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(rawPhone);

    // Idempotency: if already Success or Completed, don't double credit
    if (tx.status === 'Success' || tx.status === 'Completed') {
      const userRes = await query(`SELECT balance FROM ${tables.users} WHERE phone = $1 OR phone = $2 OR phone = $3;`, [phone254, phone0, phoneShort]);
      const balance = userRes.rows.length > 0 ? parseFloat(userRes.rows[0].balance) : 0;
      return res.status(200).json({ success: true, balance, transactions: [] });
    }

    if (isSimulated || !secretKey) {
      // Process simulated transaction transition
      if (tx.status === 'PENDING') {
        const finalStatus = status === 'success' ? 'Success' : 'Failed';

        // Update transaction status and timestamp
        await query(`
          UPDATE ${tables.transactions} 
          SET status = $1,
              created_at = CURRENT_TIMESTAMP
          WHERE reference = $2;
        `, [finalStatus, reference]);

        if (finalStatus === 'Success') {
          // Ensure user
          let user = await findUserOrImport(primary, tables);
          if (!user) user = await ensureUser(primary, tables);

          // Credit user balance
          await query(`
            UPDATE ${tables.users} 
            SET balance = ROUND(balance + $1, 2) 
            WHERE phone = $2 OR phone = $3 OR phone = $4;
          `, [amount, phone254, phone0, phoneShort]);
          console.log(`[Simulated Paystack] Credited KES ${amount} to user ${primary}`);
        }
      }
    } else {
      // Process live transaction via Paystack API
      const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Paystack verification API returned status ${response.status}`);
      }

      const resData = await response.json();
      if (!resData.status || !resData.data) {
        throw new Error(resData.message || 'Failed to verify transaction with Paystack');
      }

      const paystackStatus = resData.data.status; // 'success', 'failed', 'abandoned'
      const paystackAmount = parseFloat(resData.data.amount) / 100; // Paystack sends in cents/kobo

      if (paystackStatus === 'success') {
        if (tx.status === 'PENDING') {
          // Double check amount to prevent tampering
          if (Math.abs(paystackAmount - amount) > 0.01) {
            console.error(`Paystack verified amount KES ${paystackAmount} does not match DB amount KES ${amount}`);
            
            await query(`
              UPDATE ${tables.transactions} 
              SET status = 'Failed',
                  created_at = CURRENT_TIMESTAMP
              WHERE reference = $1;
            `, [reference]);
            return res.status(400).json({ error: 'Transaction amount mismatch.' });
          }

          // Update status to success and refresh timestamp
          await query(`
            UPDATE ${tables.transactions} 
            SET status = 'Success',
                created_at = CURRENT_TIMESTAMP
            WHERE reference = $1;
          `, [reference]);

          // Credit balance
          let user = await findUserOrImport(primary, tables);
          if (!user) user = await ensureUser(primary, tables);

          await query(`
            UPDATE ${tables.users} 
            SET balance = ROUND(balance + $1, 2) 
            WHERE phone = $2 OR phone = $3 OR phone = $4;
          `, [amount, phone254, phone0, phoneShort]);
          console.log(`[Live Paystack] Credited KES ${amount} to user ${primary}`);
        }
      } else {
        if (tx.status === 'PENDING') {
          await query(`
            UPDATE ${tables.transactions} 
            SET status = 'Failed',
                created_at = CURRENT_TIMESTAMP
            WHERE reference = $1;
          `, [reference]);
        }
      }
    }

    // 2. Fetch updated balance and transaction history to return to client
    const userQuery = await query(`
      SELECT balance FROM ${tables.users} WHERE phone = $1 OR phone = $2 OR phone = $3;
    `, [phone254, phone0, phoneShort]);
    const balance = userQuery.rows.length > 0 ? parseFloat(userQuery.rows[0].balance) : 0;

    const txsQuery = await query(`
      SELECT type, amount, status, created_at as date 
      FROM ${tables.transactions} 
      WHERE phone = $1 OR phone = $2 OR phone = $3
      ORDER BY created_at DESC, id DESC 
      LIMIT 20;
    `, [phone254, phone0, phoneShort]);

    const transactions = txsQuery.rows.map(t => {
      let isoDate = '';
      if (t.date instanceof Date) {
        isoDate = t.date.toISOString();
      } else if (t.date) {
        const dt = new Date(t.date);
        isoDate = isNaN(dt.getTime()) ? String(t.date) : dt.toISOString();
      } else {
        isoDate = new Date().toISOString();
      }
      return {
        type: t.type,
        amount: parseFloat(t.amount),
        status: t.status,
        date: isoDate
      };
    });

    return res.status(200).json({
      success: true,
      balance: balance,
      transactions: transactions
    });

  } catch (error) {
    console.error("Paystack verification endpoint error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
