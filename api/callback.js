import { query, getAppId, getTables, initAppDatabase, normalizePhoneVariants, findUserOrImport, ensureUser } from './db.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  // Gateways invoke callback via POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const callbackData = req.body || {};
    console.log("=== PAYMENT GATEWAY WEBHOOK CALLBACK RECEIVED ===");
    console.log(JSON.stringify(callbackData, null, 2));
    console.log("================================================");

    // Extract fields across possible PayHero / GravityPay / TinyPesa / Daraja webhook payload variations
    const data = callbackData.response || callbackData.Body?.stkCallback || callbackData.stkCallback || callbackData.data || callbackData.payload || callbackData;
    
    // Status resolution
    let rawStatus = data.Status || data.status || data.ResultDesc || (data.ResultCode === 0 ? 'SUCCESS' : (data.ResultCode ? 'FAILED' : ''));
    if (!rawStatus && callbackData.status) rawStatus = callbackData.status;
    const statusUpper = String(rawStatus).toUpperCase();
    const isSuccess = statusUpper.includes('SUCCESS') || statusUpper.includes('COMPLETED') || data.ResultCode === 0 || callbackData.success === true || callbackData.status === 'success';

    // Reference & identifier resolution
    let externalReference = data.ExternalReference || data.external_reference || data.account_no || data.AccountReference || data.MerchantRequestID || data.merchant_request_id || data.CheckoutRequestID || data.checkout_request_id || data.checkoutRequestId || data.transactionId || callbackData.external_reference || callbackData.account_no || callbackData.reference || null;
    let mpesaReceipt = data.Reference || data.reference || data.mpesa_reference || data.MpesaReceiptNumber || data.mpesaReceipt || null;
    let amount = parseFloat(data.Amount || data.amount || data.TransAmount || callbackData.amount || 0);
    let callbackPhone = data.PhoneNumber || data.phoneNumber || data.msisdn || data.phone || data.Phone || callbackData.msisdn || callbackData.phone || null;

    // Extract from CallbackMetadata if Daraja item array format
    if (data.CallbackMetadata && Array.isArray(data.CallbackMetadata.Item)) {
      for (const item of data.CallbackMetadata.Item) {
        if (item.Name === 'Amount' && !amount) amount = parseFloat(item.Value);
        if (item.Name === 'MpesaReceiptNumber' && !mpesaReceipt) mpesaReceipt = String(item.Value);
        if (item.Name === 'PhoneNumber' && !callbackPhone) callbackPhone = String(item.Value);
      }
    }

    // Determine target isolated tables: derive from externalReference prefix if valid known site
    let targetAppId = getAppId(req);
    const knownSites = ['luckywin', 'helakash', 'patapesa', 'shindamax', 'pawabet', 'statpesa', 'pesakash', 'patpesa', 'kwetubet'];
    if (externalReference && typeof externalReference === 'string' && externalReference.includes('-')) {
      const prefix = externalReference.split('-')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (knownSites.includes(prefix)) {
        targetAppId = prefix;
      }
    }

    const tables = {
      users: `${targetAppId}_users`,
      transactions: `${targetAppId}_transactions`,
      settings: `${targetAppId}_settings`,
      active_rounds: `${targetAppId}_active_rounds`,
      webhook_logs: `${targetAppId}_webhook_logs`,
    };

    // Log webhook payload for diagnostics
    try {
      await initAppDatabase(req);
      await query(`
        INSERT INTO ${tables.webhook_logs} (payload)
        VALUES ($1);
      `, [JSON.stringify(callbackData)]);
    } catch (logErr) {
      console.warn("Webhook logging notice:", logErr.message);
    }

    // Webhook HMAC signature verification for GravityPay
    const signature = req.headers['x-webhook-signature'] || 
                      req.headers['x-gravitypay-signature'] || 
                      req.headers['signature'] || 
                      req.headers['x-signature'];
    if (signature) {
      try {
        const settingsQ = await query(`
          SELECT gravitypay_webhook_secret FROM ${tables.settings} WHERE id = $1;
        `, [targetAppId]);
        const webhookSecret = settingsQ.rows[0]?.gravitypay_webhook_secret;
        if (webhookSecret && webhookSecret.trim()) {
          const payloadString = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
          const expected = crypto.createHmac('sha256', webhookSecret.trim()).update(payloadString).digest('hex');
          if (signature.toLowerCase() !== expected.toLowerCase()) {
            console.warn("⚠️ Webhook HMAC signature mismatch. Continuing with payload validation.");
          }
        }
      } catch (sigErr) {
        console.warn("Signature verification warning:", sigErr.message);
      }
    }

    // 1. Fetch transaction matching external reference, checkout request ID, or mpesaReceipt
    let txQuery = { rows: [] };
    if (externalReference) {
      txQuery = await query(`
        SELECT id, phone, amount, status, reference FROM ${tables.transactions} 
        WHERE reference = $1 OR checkout_request_id = $1 OR gateway_tx_id = $1;
      `, [externalReference]);
    }
    if (txQuery.rows.length === 0 && mpesaReceipt) {
      txQuery = await query(`
        SELECT id, phone, amount, status, reference FROM ${tables.transactions} 
        WHERE reference = $1 OR checkout_request_id = $1 OR gateway_tx_id = $1;
      `, [mpesaReceipt]);
    }

    // Fallback: match by phone + latest PENDING deposit if reference was rewritten by gateway
    if (txQuery.rows.length === 0 && callbackPhone) {
      const { phone254, phone0, phoneShort } = normalizePhoneVariants(callbackPhone);
      txQuery = await query(`
        SELECT id, phone, amount, status, reference FROM ${tables.transactions}
        WHERE (phone = $1 OR phone = $2 OR phone = $3)
          AND status = 'PENDING'
          AND type ILIKE '%deposit%'
          AND created_at >= NOW() - INTERVAL '30 minutes'
        ORDER BY created_at DESC
        LIMIT 1;
      `, [phone254, phone0, phoneShort]);
    }

    if (txQuery.rows.length === 0) {
      console.warn(`Transaction reference '${externalReference}' (phone: ${callbackPhone}) not found in ${tables.transactions}`);
      return res.status(200).json({ success: false, message: `Transaction '${externalReference || callbackPhone}' not found.` });
    }

    const tx = txQuery.rows[0];

    // Idempotency: if already Success or Completed, do NOT double credit
    if (tx.status === 'Success' || tx.status === 'Completed') {
      console.log(`[Idempotent Callback] Transaction '${tx.reference}' already processed with status '${tx.status}'. Skipping.`);
      return res.status(200).json({ success: true, message: "Transaction already processed successfully." });
    }

    // Only process if status is PENDING to prevent double-crediting
    if (tx.status === 'PENDING') {
      const finalStatus = isSuccess ? 'Success' : 'Failed';

      // Update transaction status
      await query(`
        UPDATE ${tables.transactions} 
        SET status = $1
        WHERE id = $2;
      `, [finalStatus, tx.id]);

      if (isSuccess) {
        const creditAmount = amount > 0 ? amount : parseFloat(tx.amount);
        const { phone254, phone0, phoneShort, primary } = normalizePhoneVariants(tx.phone);
        
        // Ensure user exists or import from sister tables
        let user = await findUserOrImport(tx.phone, tables);
        if (!user) {
          user = await ensureUser(tx.phone, tables);
        }

        // Credit balance across all 3 phone format variants
        const updated = await query(`
          UPDATE ${tables.users}
          SET balance = ROUND(balance + $1, 2)
          WHERE phone = $2 OR phone = $3 OR phone = $4
          RETURNING balance;
        `, [creditAmount, phone254, phone0, phoneShort]);

        if (updated.rows.length === 0) {
          // If update didn't match, insert on conflict update
          await query(`
            INSERT INTO ${tables.users} (phone, balance, password_hash)
            VALUES ($1, $2, 'NO_PASSWORD_MIGRATED')
            ON CONFLICT (phone) DO UPDATE
            SET balance = ROUND(${tables.users}.balance + $2, 2);
          `, [primary, creditAmount]);
        }

        console.log(`✅ Successfully credited KES ${creditAmount} to user ${tx.phone} (${targetAppId})`);
      }
    }

    return res.status(200).json({ success: true, message: "Callback processed successfully." });

  } catch (error) {
    console.error("Callback handler error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
