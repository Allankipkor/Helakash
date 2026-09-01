import { query, getTables, initAppDatabase, normalizePhoneVariants, findUserOrImport, ensureUser } from './db.js';

export default async function handler(req, res) {
  const tables = getTables(req);

  // Allow GET or POST
  const rawPhone = req.query.phone || (req.body && req.body.phone);
  if (!rawPhone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(rawPhone);

  if (!/^254[71]\d{8}$/.test(phone254)) {
    return res.status(400).json({ error: 'Invalid Kenyan phone number format.' });
  }

  try {
    try {
      await initAppDatabase(req);
    } catch (_) {}

    // 1. Fetch user from DB (or import from sister tables if missing)
    let user = await findUserOrImport(rawPhone, tables);
    if (!user) {
      user = await ensureUser(rawPhone, tables);
    }

    // 2. Real-time Status Fallback: If user has recent pending deposits, check GravityPay live status
    const checkoutRequestId = req.query.checkout_request_id || (req.body && req.body.checkout_request_id);
    const transactionId = req.query.transaction_id || (req.body && req.body.transaction_id);
    const reference = req.query.reference || (req.body && req.body.reference);

    const pendingTxQuery = await query(`
      SELECT id, phone, amount, status, reference, checkout_request_id, gateway_tx_id
      FROM ${tables.transactions}
      WHERE (phone = $1 OR phone = $2 OR phone = $3)
        AND (LOWER(type) = 'deposit' OR LOWER(type) = 'mpesa deposit')
        AND UPPER(status) = 'PENDING'
        AND created_at >= NOW() - INTERVAL '30 minutes'
      ORDER BY created_at DESC
      LIMIT 5;
    `, [phone254, phone0, phoneShort]);

    const targetCheckout = checkoutRequestId || transactionId;
    if (pendingTxQuery.rows.length > 0 || targetCheckout || reference) {
      try {
        const appId = tables.users.replace('_users', '');
        const settingsQ = await query(`SELECT gravitypay_api_key, gravitypay_secret_key FROM ${tables.settings} WHERE id = $1;`, [appId]);
        const apiKey = settingsQ.rows[0]?.gravitypay_api_key;
        const secretKey = settingsQ.rows[0]?.gravitypay_secret_key;

        if (apiKey && secretKey) {
          const idsToCheck = [];
          if (targetCheckout) idsToCheck.push(targetCheckout);
          if (reference && !idsToCheck.includes(reference)) idsToCheck.push(reference);

          for (const pTx of pendingTxQuery.rows) {
            if (pTx.checkout_request_id && !idsToCheck.includes(pTx.checkout_request_id)) {
              idsToCheck.push(pTx.checkout_request_id);
            }
            if (pTx.gateway_tx_id && !idsToCheck.includes(pTx.gateway_tx_id)) {
              idsToCheck.push(pTx.gateway_tx_id);
            }
            if (pTx.reference && !idsToCheck.includes(pTx.reference)) {
              idsToCheck.push(pTx.reference);
            }
          }

          for (const chkId of idsToCheck) {
            try {
              const gpStatusRes = await fetch(`https://api.gravitypayapp.com/api/v1/stk/status/${encodeURIComponent(chkId)}`, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${secretKey}`,
                  'x-api-key': apiKey,
                  'Content-Type': 'application/json'
                }
              });

              if (gpStatusRes.ok) {
                const gpData = await gpStatusRes.json();
                const statusStr = (gpData.data?.status || gpData.status || '').toLowerCase();
                const mpesaCode = gpData.data?.mpesaReceipt || gpData.mpesaReceipt;

                if (statusStr === 'success' || statusStr === 'completed' || mpesaCode) {
                  const matchedTx = pendingTxQuery.rows.find(t => 
                    t.checkout_request_id === chkId || 
                    t.gateway_tx_id === chkId || 
                    t.reference === chkId
                  ) || pendingTxQuery.rows[0];

                  if (matchedTx) {
                    const creditAmt = parseFloat(gpData.data?.amount || gpData.amount || matchedTx.amount || 0);

                    await query(`
                      UPDATE ${tables.transactions}
                      SET status = 'Success'
                      WHERE id = $1 AND UPPER(status) = 'PENDING';
                    `, [matchedTx.id]);

                    const updatedUser = await query(`
                      UPDATE ${tables.users}
                      SET balance = ROUND(balance + $1, 2)
                      WHERE phone = $2 OR phone = $3 OR phone = $4
                      RETURNING phone, balance, created_at;
                    `, [creditAmt, phone254, phone0, phoneShort]);

                    if (updatedUser.rows.length > 0) {
                      user = updatedUser.rows[0];
                      console.log(`[REALTIME POLL] Verified GravityPay deposit KES ${creditAmt} for ${rawPhone}. New balance: KES ${user.balance}`);
                    }
                    break;
                  }
                }
              }
            } catch (_) {}
          }
        }
      } catch (pollErr) {
        console.warn("GravityPay real-time poll notice:", pollErr.message);
      }
    }

    const currentBalance = parseFloat(user.balance || 0.00);
    const userPhone = user.phone || primary;

    // 3. Fetch last 25 transactions for user matching any of the 3 phone variants
    const txQuery = await query(`
      SELECT id, type, amount, status, reference, created_at 
      FROM ${tables.transactions} 
      WHERE phone = $1 OR phone = $2 OR phone = $3 
      ORDER BY created_at DESC 
      LIMIT 25;
    `, [phone254, phone0, phoneShort]);

    return res.status(200).json({
      success: true,
      phone: userPhone,
      balance: currentBalance,
      user: {
        phone: userPhone,
        balance: currentBalance,
        created_at: user.created_at
      },
      transactions: txQuery.rows.map(tx => ({
        id: tx.id,
        type: tx.type,
        amount: parseFloat(tx.amount),
        status: tx.status,
        reference: tx.reference,
        created_at: tx.created_at,
        date: tx.created_at
      }))
    });
  } catch (error) {
    console.error("user-details error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
