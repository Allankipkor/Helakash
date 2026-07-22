import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL, { fullResults: true });

export default async function handler(req, res) {
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

  const secretKey = cleanEnvVar(process.env.PAYSTACK_SECRET_KEY);

  // Check if simulated reference
  const isSimulated = reference.startsWith('PS-SIM-');

  try {
    // 1. Fetch current transaction details
    const txQuery = await sql`
      SELECT phone, amount, status FROM helakash_transactions 
      WHERE reference = ${reference};
    `;

    if (txQuery.rows.length === 0) {
      return res.status(404).json({ error: `Transaction ${reference} not found in database.` });
    }

    const tx = txQuery.rows[0];
    const phone = tx.phone;
    const amount = parseFloat(tx.amount);

    if (isSimulated || !secretKey) {
      // Process simulated transaction transition
      if (tx.status === 'PENDING') {
        const finalStatus = status === 'success' ? 'Success' : 'Failed';

        // Update transaction status
        await sql`
          UPDATE helakash_transactions 
          SET status = ${finalStatus}
          WHERE reference = ${reference};
        `;

        if (finalStatus === 'Success') {
          // Credit user balance
          await sql`
            UPDATE helakash_users 
            SET balance = balance + ${amount}
            WHERE phone = ${phone};
          `;
          console.log(`[Simulated] Credited KES ${amount} to user ${phone}`);
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
            
            await sql`
              UPDATE helakash_transactions 
              SET status = 'Failed'
              WHERE reference = ${reference};
            `;
            return res.status(400).json({ error: 'Transaction amount mismatch.' });
          }

          // Update status to success
          await sql`
            UPDATE helakash_transactions 
            SET status = 'Success'
            WHERE reference = ${reference};
          `;

          // Credit balance
          await sql`
            UPDATE helakash_users 
            SET balance = balance + ${amount}
            WHERE phone = ${phone};
          `;
          console.log(`[Live] Credited KES ${amount} to user ${phone}`);
        }
      } else {
        if (tx.status === 'PENDING') {
          await sql`
            UPDATE helakash_transactions 
            SET status = 'Failed'
            WHERE reference = ${reference};
          `;
        }
      }
    }

    // 2. Fetch updated balance and transaction history to return to client
    const userQuery = await sql`
      SELECT balance FROM helakash_users WHERE phone = ${phone};
    `;
    const balance = parseFloat(userQuery.rows[0].balance);

    const txsQuery = await sql`
      SELECT type, amount, status, created_at as date 
      FROM helakash_transactions 
      WHERE phone = ${phone} 
      ORDER BY created_at DESC 
      LIMIT 20;
    `;

    const transactions = txsQuery.rows.map(t => ({
      type: t.type,
      amount: parseFloat(t.amount),
      status: t.status,
      date: new Date(t.date).toLocaleString()
    }));

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
