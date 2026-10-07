import paystack from "../config/paystack";
import pool from "../config/database";

// =========================================================
// CREATE PAYSTACK PLAN
// =========================================================

export const createPaystackPlan = async (
  planId: number,
  name: string,
  amount: number,
  interval: string
) => {
  // Create recurring plan in Paystack
  const response = await paystack.post("/plan", {
    name,
    amount,
    interval,
    currency: "ZAR",
  });

  const paystackPlanCode =
    response.data.data.plan_code;

  // Save Paystack plan code locally
  await pool.query(
    `
    UPDATE subscription_plans
    SET paystack_plan_code = $1
    WHERE id = $2
    `,
    [
      paystackPlanCode,
      planId,
    ]
  );

  return response.data.data;
};

// =========================================================
// SETUP PAYSTACK PLANS
// =========================================================

export const setupPaystackPlans = async () => {
  const plans = await pool.query(`
    SELECT
      id,
      name,
      price_zar,
      billing_interval,
      paystack_plan_code
    FROM subscription_plans
    WHERE name IN ('Standard', 'Premium')
    ORDER BY id
  `);

  for (const plan of plans.rows) {
    // Don't create duplicate Paystack plans
    if (plan.paystack_plan_code) {
      continue;
    }

    const paystackPlan =
      await createPaystackPlan(
        plan.id,
        plan.name,
        Math.round(
          Number(plan.price_zar) * 100
        ),
        plan.billing_interval
      );

    console.log(
      `${plan.name} Paystack plan created: ${paystackPlan.plan_code}`
    );
  }
};

// =========================================================
// INITIALIZE PAYMENT
// =========================================================

export const initializePayment = async (
  email: string,
  planId: number,
  userId: number
) => {
  // Get selected plan
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
    LIMIT 1
    `,
    [planId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error(
      "Payment plan not found"
    );
  }

  const plan = result.rows[0];

  // Generate unique Paystack reference
  const reference =
    `PAY-${userId}-${Date.now()}`;

  // Convert ZAR to cents
  const amount =
    Math.round(
      Number(plan.price_zar) * 100
    );

  // =======================================================
  // SUBSCRIPTION PAYMENT
  // Standard / Premium
  // =======================================================

  if (plan.paystack_plan_code) {
    const response = await paystack.post(
      "/transaction/initialize",
      {
        email,
        amount,
        currency: "ZAR",
        reference,
        plan: plan.paystack_plan_code,
      }
    );

    // Save pending subscription payment
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
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6
      )
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
      authorization_url:
        response.data.data.authorization_url,
      access_code:
        response.data.data.access_code,
      payment_type: "subscription",
      plan: {
        id: plan.id,
        name: plan.name,
        price_zar: plan.price_zar,
      },
    };
  }

  // =======================================================
  // ONE-TIME PAYMENT
  // Video Add-on
  // =======================================================

  if (plan.name === "Video Add-on") {
    const response = await paystack.post(
      "/transaction/initialize",
      {
        email,
        amount,
        currency: "ZAR",
        reference,
      }
    );

    // Save pending video payment
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
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6
      )
      `,
      [
        userId,
        reference,
        plan.price_zar,
        "ZAR",
        "video_addon",
        "pending",
      ]
    );

    return {
      reference,
      authorization_url:
        response.data.data.authorization_url,
      access_code:
        response.data.data.access_code,
      payment_type: "video_addon",
      plan: {
        id: plan.id,
        name: plan.name,
        price_zar: plan.price_zar,
      },
    };
  }

  // =======================================================
  // INVALID PAYMENT PLAN
  // =======================================================

  throw new Error(
    "Payment plan is not configured correctly"
  );
};

// =========================================================
// VERIFY PAYMENT
// =========================================================

export const verifyPayment = async (
  reference: string
) => {
  // Ask Paystack for transaction status
  const response = await paystack.get(
    `/transaction/verify/${reference}`
  );

  const transaction =
    response.data.data;

  // Find local payment
  const paymentResult = await pool.query(
    `
    SELECT
      id,
      user_id,
      amount_zar,
      currency,
      payment_type,
      status
    FROM payments
    WHERE paystack_reference = $1
    LIMIT 1
    `,
    [reference]
  );

  if ((paymentResult.rowCount ?? 0) === 0) {
    throw new Error(
      "Payment record not found"
    );
  }

  const payment =
    paymentResult.rows[0];

  // =======================================================
  // VERIFY CURRENCY
  // =======================================================

  if (transaction.currency !== payment.currency) {
    throw new Error(
      "Payment currency does not match"
    );
  }

  // =======================================================
  // VERIFY AMOUNT
  // =======================================================

  const expectedAmount =
    Math.round(
      Number(payment.amount_zar) * 100
    );

  if (
    transaction.amount !== expectedAmount
  ) {
    throw new Error(
      "Payment amount does not match"
    );
  }

  // =======================================================
  // PAYMENT FAILED
  // =======================================================

  if (
    transaction.status !== "success"
  ) {
    await pool.query(
      `
      UPDATE payments
      SET status = $1
      WHERE id = $2
      `,
      [
        transaction.status,
        payment.id,
      ]
    );

    return {
      success: false,
      status: transaction.status,
      reference,
    };
  }

  // =======================================================
  // PAYMENT SUCCESSFUL
  // =======================================================

  await pool.query(
    `
    UPDATE payments
    SET
      status = 'successful',
      paid_at = $1
    WHERE id = $2
    `,
    [
      transaction.paid_at,
      payment.id,
    ]
  );

  return {
    success: true,
    status: "successful",
    reference,
    amount: transaction.amount,
    paid_at: transaction.paid_at,
    payment_type:
      payment.payment_type,
  };
};