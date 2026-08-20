import { query, getAppId, getTables, initAppDatabase } from './db.js';

export default async function handler(req, res) {
  // Pay Hero invokes callback via POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const callbackData = req.body || {};
    console.log("=== PAY HERO WEBHOOK CALLBACK RECEIVED ===");
    console.log(JSON.stringify(callbackData, null, 2));
    console.log("=========================================");

    // Extract fields across possible Pay Hero / Daraja webhook payload variations
    const data = callbackData.response || callbackData.Body?.stkCallback || callbackData;
    
    // Status resolution
    let rawStatus = data.Status || data.status || data.ResultDesc || (data.ResultCode === 0 ? 'SUCCESS' : (data.ResultCode ? 'FAILED' : ''));
    if (!rawStatus && callbackData.status) rawStatus = callbackData.status;
    const statusUpper = String(rawStatus).toUpperCase();
    const isSuccess = statusUpper.includes('SUCCESS') || data.ResultCode === 0 || callbackData.success === true;

    // Reference resolution
    let externalReference = data.ExternalReference || data.external_reference || data.MerchantRequestID || data.CheckoutRequestID || callbackData.external_reference;
    let mpesaReceipt = data.Reference || data.reference || data.MpesaReceiptNumber || null;
    let amount = parseFloat(data.Amount || data.amount || 0);

    // Extract from CallbackMetadata if Daraja item array format
    if (data.CallbackMetadata && Array.isArray(data.CallbackMetadata.Item)) {
      for (const item of data.CallbackMetadata.Item) {
        if (item.Name === 'Amount' && !amount) amount = parseFloat(item.Value);
        if (item.Name === 'MpesaReceiptNumber' && !mpesaReceipt) mpesaReceipt = String(item.Value);
      }
    }

    // Determine target isolated tables: derive from externalReference prefix if available
    let targetAppId = getAppId(req);
    if (externalReference && typeof externalReference === 'string' && externalReference.includes('-')) {
      const prefix = externalReference.split('-')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (prefix && prefix !== 'sim' && prefix !== 'mpesa') {
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

    if (!externalReference) {
      console.warn("Missing external reference in callback payload.");
      return res.status(200).json({ success: false, message: "No external reference found in callback." });
    }

    // 1. Fetch transaction
    const txQuery = await query(`
      SELECT id, phone, amount, status FROM ${tables.transactions} 
      WHERE reference = $1;
    `, [externalReference]);

    if (txQuery.rows.length === 0) {
      console.warn(`Transaction reference '${externalReference}' not found in ${tables.transactions}`);
      return res.status(200).json({ success: false, message: `Transaction '${externalReference}' not found.` });
    }

    const tx = txQuery.rows[0];

    // Only process if status is PENDING to prevent double-crediting
    if (tx.status === 'PENDING') {
      const finalStatus = isSuccess ? 'Success' : 'Failed';
      const updatedRef = mpesaReceipt || externalReference;

      // Update transaction status
      await query(`
        UPDATE ${tables.transactions} 
        SET status = $1, reference = $2
        WHERE id = $3;
      `, [finalStatus, updatedRef, tx.id]);

      if (isSuccess) {
        const creditAmount = amount > 0 ? amount : parseFloat(tx.amount);
        
        // Ensure user exists and credit balance
        await query(`
          INSERT INTO ${tables.users} (phone, balance, password_hash)
          VALUES ($1, $2, 'NO_PASSWORD_MIGRATED')
          ON CONFLICT (phone) DO UPDATE
          SET balance = ${tables.users}.balance + $2;
        `, [tx.phone, creditAmount]);

        console.log(`✅ Successfully credited KES ${creditAmount} to user ${tx.phone} (${targetAppId})`);
      }
    }

    return res.status(200).json({ success: true, message: "Callback processed successfully." });

  } catch (error) {
    console.error("Callback handler error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
