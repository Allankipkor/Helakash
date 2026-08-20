import { query, getTables } from './db.js';

export default async function handler(req, res) {
  const tables = getTables(req);

  // Pay Hero invokes callback via POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const callbackData = req.body;
    console.log("=== PAY HERO WEBHOOK CALLBACK RECEIVED ===");
    console.log(JSON.stringify(callbackData, null, 2));
    console.log("=========================================");

    // Log webhook payload to DB for debugging
    try {
      await query(`
        INSERT INTO ${tables.webhook_logs} (payload)
        VALUES ($1);
      `, [JSON.stringify(callbackData)]);
    } catch (logErr) {
      console.error("Failed to log webhook to DB:", logErr.message);
    }

    // Extract parameters from Pay Hero webhook payload
    const data = callbackData.response || callbackData;
    const status = data.Status || data.status || (data.ResultCode === 0 ? 'SUCCESS' : 'FAILED');
    const externalReference = data.ExternalReference || data.external_reference || data.MerchantRequestID;
    const amount = parseFloat(data.Amount || data.amount || 0);
    const mpesaReceipt = data.Reference || data.reference || data.MpesaReceiptNumber;

    if (!externalReference) {
      return res.status(400).json({ error: "Missing ExternalReference in payload" });
    }

    const uppercaseStatus = status.toUpperCase();

    // 1. Fetch transaction to get phone and confirm it exists
    const txQuery = await query(`
      SELECT phone, amount, status FROM ${tables.transactions} 
      WHERE reference = $1;
    `, [externalReference]);

    if (txQuery.rows.length === 0) {
      return res.status(404).json({ error: `Transaction ${externalReference} not found in database` });
    }

    const tx = txQuery.rows[0];
    
    // Only process if transaction status is PENDING to prevent double-crediting
    if (tx.status === 'PENDING') {
      const finalStatus = uppercaseStatus === 'SUCCESS' ? 'Success' : 'Failed';
      
      // Update transaction status
      await query(`
        UPDATE ${tables.transactions} 
        SET status = $1, reference = COALESCE($2, reference)
        WHERE reference = $3;
      `, [finalStatus, mpesaReceipt || null, externalReference]);

      if (uppercaseStatus === 'SUCCESS') {
        const creditAmount = amount || parseFloat(tx.amount);
        
        // Update user balance
        await query(`
          UPDATE ${tables.users} 
          SET balance = balance + $1 
          WHERE phone = $2;
        `, [creditAmount, tx.phone]);
        console.log(`Credited KES ${creditAmount} to user ${tx.phone} for transaction ${externalReference}`);
      }
    }

    return res.status(200).json({ success: true, message: "Callback processed successfully" });
  } catch (error) {
    console.error("Callback processing error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
