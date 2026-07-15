import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export default async function handler(req, res) {
  // Pay Hero invokes callback via POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const callbackData = req.body;
    console.log("=== PAY HERO WEBHOOK CALLBACK RECEIVED ===");
    console.log(JSON.stringify(callbackData, null, 2));
    console.log("=========================================");

    // Extract parameters from Pay Hero webhook payload
    // Handle both live webhook formats and simulated manual webhooks
    const status = callbackData.Status || callbackData.status || (callbackData.ResultCode === 0 ? 'SUCCESS' : 'FAILED');
    const externalReference = callbackData.ExternalReference || callbackData.external_reference || callbackData.MerchantRequestID;
    const amount = parseFloat(callbackData.Amount || callbackData.amount || 0);
    const mpesaReceipt = callbackData.Reference || callbackData.reference || callbackData.MpesaReceiptNumber;

    if (!externalReference) {
      return res.status(400).json({ error: "Missing ExternalReference in payload" });
    }

    const uppercaseStatus = status.toUpperCase();

    // 1. Fetch transaction to get phone and confirm it exists
    const txQuery = await sql`
      SELECT phone, amount, status FROM helakash_transactions 
      WHERE reference = ${externalReference};
    `;

    if (txQuery.rows.length === 0) {
      return res.status(404).json({ error: `Transaction ${externalReference} not found in database` });
    }

    const tx = txQuery.rows[0];
    
    // Only process if transaction status is PENDING to prevent double-crediting
    if (tx.status === 'PENDING') {
      const finalStatus = uppercaseStatus === 'SUCCESS' ? 'Success' : 'Failed';
      
      // Update transaction status
      await sql`
        UPDATE helakash_transactions 
        SET status = ${finalStatus}, reference = COALESCE(${mpesaReceipt}, reference)
        WHERE reference = ${externalReference};
      `;

      if (uppercaseStatus === 'SUCCESS') {
        const creditAmount = amount || parseFloat(tx.amount);
        
        // Update user balance
        await sql`
          UPDATE helakash_users 
          SET balance = balance + ${creditAmount} 
          WHERE phone = ${tx.phone};
        `;
        console.log(`Credited KES ${creditAmount} to user ${tx.phone} for transaction ${externalReference}`);
      }
    }

    return res.status(200).json({ success: true, message: "Callback processed successfully" });
  } catch (error) {
    console.error("Callback processing error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
