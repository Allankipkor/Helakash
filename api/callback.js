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

    // Typical fields from Pay Hero Callback body:
    // - Status: "SUCCESS" or "FAILED"
    // - Amount: transaction amount
    // - Reference: internal reference / M-Pesa Receipt Number
    // - ExternalReference: the invoice/ref we supplied (e.g., HK-17000000000)
    // - PhoneNumber: user's MSISDN
    
    // In a production application, you would check if (Status === 'SUCCESS')
    // and query your database to update the corresponding player's balance.

    return res.status(200).json({ success: true, message: "Callback received and logged" });
  } catch (error) {
    console.error("Callback processing error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
