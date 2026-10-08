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
  // -------------------------------------------------------
  // Validate interval
  // -------------------------------------------------------

  const validIntervals = [
    "daily",
    "weekly",
    "monthly",
    "quarterly",
    "biannually",
    "annually",
  ];

  if (!validIntervals.includes(interval)) {
    throw new Error(
      `Invalid Paystack plan interval: ${interval}`
    );
  }

  // -------------------------------------------------------
  // Create plan in Paystack
  // -------------------------------------------------------

  const response = await paystack.post(
    "/plan",
    {
      name,
      amount,
      interval,
      currency: "ZAR",
    }
  );

  const paystackPlan =
    response.data.data;

  if (!paystackPlan?.plan_code) {
    throw new Error(
      "Paystack did not return a plan code"
    );
  }

  // -------------------------------------------------------
  // Save Paystack plan code locally
  // -------------------------------------------------------

  await pool.query(
    `
    UPDATE subscription_plans
    SET
      paystack_plan_code = $1
    WHERE id = $2
    `,
    [
      paystackPlan.plan_code,
      planId,
    ]
  );

  return paystackPlan;
};

// =========================================================
// SETUP PAYSTACK PLANS
// =========================================================
//
// IMPORTANT:
// This function does NOT run automatically when the server
// starts.
//
// It is intended for initial Paystack plan configuration.
// =========================================================

export const setupPaystackPlans = async () => {
  const result = await pool.query(
    `
    SELECT
      id,
      name,
      price_zar,
      billing_interval,
      paystack_plan_code
    FROM subscription_plans
    WHERE name IN (
      'Standard',
      'Premium'
    )
      AND active = true
    ORDER BY id
    `
  );

  for (
    const plan of result.rows
  ) {
    // -----------------------------------------------------
    // Do not create duplicate Paystack plans
    // -----------------------------------------------------

    if (
      plan.paystack_plan_code
    ) {
      continue;
    }

    const paystackPlan =
      await createPaystackPlan(
        plan.id,
        plan.name,
        Math.round(
          Number(
            plan.price_zar
          ) * 100
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
  // -------------------------------------------------------
  // Get selected plan
  // -------------------------------------------------------

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

  if (
    (result.rowCount ?? 0) === 0
  ) {
    throw new Error(
      "Payment plan not found"
    );
  }

  const plan =
    result.rows[0];

  // -------------------------------------------------------
  // Make sure the user exists
  // -------------------------------------------------------

  const userResult =
    await pool.query(
      `
      SELECT
        id,
        email
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

  if (
    (userResult.rowCount ?? 0) === 0
  ) {
    throw new Error(
      "User not found"
    );
  }

  const user =
    userResult.rows[0];

  // -------------------------------------------------------
  // Use database email rather than trusting a different
  // email supplied by the frontend.
  // -------------------------------------------------------

  const paymentEmail =
    user.email;

  // -------------------------------------------------------
  // Generate unique reference
  // -------------------------------------------------------

  const reference =
    `PAY-${userId}-${Date.now()}`;

  // =======================================================
  // SUBSCRIPTION PAYMENT
  // =======================================================
  //
  // Standard / Premium
  //
  // Paystack's plan code causes the customer to become
  // subscribed after the transaction succeeds.
  // =======================================================

  if (
    plan.name === "Standard" ||
    plan.name === "Premium"
  ) {
    if (
      !plan.paystack_plan_code
    ) {
      throw new Error(
        `${plan.name} Paystack plan is not configured`
      );
    }

    const amount =
      Math.round(
        Number(
          plan.price_zar
        ) * 100
      );

    const response =
      await paystack.post(
        "/transaction/initialize",
        {
          email: paymentEmail,

          amount,

          currency: "ZAR",

          reference,

          plan:
            plan.paystack_plan_code,

          channels: [
            "card",
          ],

          callback_url:
            process.env.PAYSTACK_PAYMENT_RETURN_URL,

          metadata: {
            user_id: userId,
            plan_id: plan.id,
            payment_type:
              "subscription",
          },
        }
      );

    // -----------------------------------------------------
    // Save pending payment
    // -----------------------------------------------------

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
        response.data.data
          .authorization_url,

      access_code:
        response.data.data
          .access_code,

      payment_type:
        "subscription",

      plan: {
        id: plan.id,
        name: plan.name,
        price_zar:
          Number(
            plan.price_zar
          ),
      },
    };
  }

  // =======================================================
  // VIDEO ADD-ON
  // =======================================================

  if (
    plan.name ===
    "Video Add-on"
  ) {
    const amount =
      Math.round(
        Number(
          plan.price_zar
        ) * 100
      );

    const response =
      await paystack.post(
        "/transaction/initialize",
        {
          email: paymentEmail,

          amount,

          currency: "ZAR",

          reference,

          channels: [
            "card",
          ],

          callback_url:
            process.env.PAYSTACK_PAYMENT_RETURN_URL,

          metadata: {
            user_id: userId,
            plan_id: plan.id,
            payment_type:
              "video_addon",
          },
        }
      );

    // -----------------------------------------------------
    // Save pending video payment
    // -----------------------------------------------------

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
        response.data.data
          .authorization_url,

      access_code:
        response.data.data
          .access_code,

      payment_type:
        "video_addon",

      plan: {
        id: plan.id,
        name: plan.name,
        price_zar:
          Number(
            plan.price_zar
          ),
      },
    };
  }

  // =======================================================
  // INVALID PLAN
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
  // -------------------------------------------------------
  // Find local payment first
  // -------------------------------------------------------

  const paymentResult =
    await pool.query(
      `
      SELECT
        id,
        user_id,
        subscription_id,
        paystack_reference,
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

  if (
    (paymentResult.rowCount ?? 0) === 0
  ) {
    throw new Error(
      "Payment record not found"
    );
  }

  const payment =
    paymentResult.rows[0];

  // -------------------------------------------------------
  // Verify transaction with Paystack
  // -------------------------------------------------------

  const response =
    await paystack.get(
      `/transaction/verify/${encodeURIComponent(
        reference
      )}`
    );

  const transaction =
    response.data.data;

  if (!transaction) {
    throw new Error(
      "Paystack transaction data not found"
    );
  }

  // =======================================================
  // VERIFY REFERENCE
  // =======================================================

  if (
    transaction.reference !==
    payment.paystack_reference
  ) {
    throw new Error(
      "Payment reference does not match"
    );
  }

  // =======================================================
  // VERIFY CURRENCY
  // =======================================================

  if (
    transaction.currency !==
    payment.currency
  ) {
    throw new Error(
      "Payment currency does not match"
    );
  }

  // =======================================================
  // VERIFY AMOUNT
  // =======================================================

  const expectedAmount =
    Math.round(
      Number(
        payment.amount_zar
      ) * 100
    );

  if (
    Number(
      transaction.amount
    ) !== expectedAmount
  ) {
    throw new Error(
      "Payment amount does not match"
    );
  }

  // =======================================================
  // PAYMENT NOT SUCCESSFUL
  // =======================================================

  if (
    transaction.status !==
    "success"
  ) {
    await pool.query(
      `
      UPDATE payments
      SET
        status = $1
      WHERE id = $2
      `,
      [
        transaction.status,
        payment.id,
      ]
    );

    return {
      success: false,

      status:
        transaction.status,

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
      paid_at = COALESCE(
        $1,
        CURRENT_TIMESTAMP
      )
    WHERE id = $2
    `,
    [
      transaction.paid_at ??
        null,
      payment.id,
    ]
  );

  return {
    success: true,

    status: "successful",

    reference,

    amount:
      transaction.amount,

    paid_at:
      transaction.paid_at,

    payment_type:
      payment.payment_type,
  };
};