import paystack from "../config/paystack";
import pool from "../config/database";

export const createPaystackPlan = async (
  planId: number,
  name: string,
  amount: number,
  interval: string
) => {
  // Create the plan in Paystack
  const response = await paystack.post("/plan", {
    name,
    amount,
    interval,
    currency: "ZAR",
  });

  const paystackPlanCode = response.data.data.plan_code;

  // Save the Paystack plan code in PostgreSQL
  await pool.query(
    `
    UPDATE subscription_plans
    SET paystack_plan_code = $1
    WHERE id = $2
    `,
    [paystackPlanCode, planId]
  );

  return response.data.data;
};

export const setupPaystackPlans = async () => {
  const plans = await pool.query(`
    SELECT id, name, price_zar, billing_interval, paystack_plan_code
    FROM subscription_plans
    WHERE name IN ('Standard', 'Premium')
    ORDER BY id
  `);

  for (const plan of plans.rows) {
    // Skip if this plan already has a Paystack plan code
    if (plan.paystack_plan_code) {
      continue;
    }

    const paystackPlan = await createPaystackPlan(
      plan.id,
      plan.name,
      Math.round(Number(plan.price_zar) * 100),
      plan.billing_interval
    );

    console.log(
      `${plan.name} Paystack plan created: ${paystackPlan.plan_code}`
    );
  }
};

export const initializePayment = async (
  email: string,
  planId: number,
  userId: number
) => {
  // Get the plan from PostgreSQL
  const result = await pool.query(
    `
    SELECT
      id,
      name,
      price_zar,
      billing_interval,
      paystack_plan_code
    FROM subscription_plans
    WHERE id = $1
      AND active = true
    `,
    [planId]
  );

  if (result.rows.length === 0) {
    throw new Error("Subscription plan not found");
  }

  const plan = result.rows[0];

  if (!plan.paystack_plan_code) {
    throw new Error("Paystack plan has not been configured");
  }

  // Generate a unique reference
  const reference = `PAY-${userId}-${Date.now()}`;

  // Initialize transaction with Paystack
  const response = await paystack.post("/transaction/initialize", {
    email,
    amount: Math.round(Number(plan.price_zar) * 100),
    currency: "ZAR",
    reference,
    plan: plan.paystack_plan_code,
  });

  // Save the pending payment
  await pool.query(
    `
    INSERT INTO payments (
      user_id,
      paystack_reference,
      amount_zar,
      currency,
      payment_type,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      userId,
      reference,
      plan.price_zar,
      "ZAR",
      "subscription",
      "pending",
    ]
  );

  return {
    reference,
    authorization_url: response.data.data.authorization_url,
    access_code: response.data.data.access_code,
    plan: {
      id: plan.id,
      name: plan.name,
      price_zar: plan.price_zar,
    },
  };
};

export const verifyPayment = async (reference: string) => {
  // Ask Paystack for the current status of this transaction
  const response = await paystack.get(
    `/transaction/verify/${reference}`
  );

  // Get the actual transaction information from Paystack's response
  const transaction = response.data.data;

  // Find our payment record using the Paystack reference
  const paymentResult = await pool.query(
    `
    SELECT
      id,
      user_id,
      amount_zar,
      currency,
      status
    FROM payments
    WHERE paystack_reference = $1
    `,
    [reference]
  );

  // Make sure the payment exists in our own database
  if (paymentResult.rows.length === 0) {
    throw new Error("Payment record not found");
  }

  const payment = paymentResult.rows[0];

  // Convert our database amount from ZAR to cents
  const expectedAmount = Math.round(
    Number(payment.amount_zar) * 100
  );

  // Make sure Paystack reports the expected amount
  if (transaction.amount !== expectedAmount) {
    throw new Error("Payment amount does not match");
  }

  // Make sure the payment was actually successful
  if (transaction.status !== "success") {
    await pool.query(
      `
      UPDATE payments
      SET status = $1
      WHERE id = $2
      `,
      [transaction.status, payment.id]
    );

    return {
      success: false,
      status: transaction.status,
      reference,
    };
  }

  // Update our payment record to successful
  await pool.query(
    `
    UPDATE payments
    SET
      status = $1,
      paid_at = $2
    WHERE id = $3
    `,
    [
      "successful",
      transaction.paid_at,
      payment.id,
    ]
  );

  // Return the verified payment information
  return {
    success: true,
    status: "successful",
    reference,
    amount: transaction.amount,
    paid_at: transaction.paid_at,
  };
};


















