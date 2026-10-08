import pool from "../config/database";
import paystack from "../config/paystack";

// =========================================================
// CONSTANTS
// =========================================================

const TRIAL_DAYS = 3;

// Small temporary charge used to tokenize/verify the card.
// Paystack recommends a small charge for this workaround.
const CARD_VERIFICATION_AMOUNT = 100; // R1.00 in cents

// =========================================================
// START TRIAL
// =========================================================

export const startTrial = async (
  userId: number,
  planId: number
) => {
  // -------------------------------------------------------
  // 1. Find selected subscription plan
  // -------------------------------------------------------

  const planResult = await pool.query(
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
      AND name IN ('Standard', 'Premium')
    LIMIT 1
    `,
    [planId]
  );

  if ((planResult.rowCount ?? 0) === 0) {
    throw new Error("Trial plan not found");
  }

  const plan = planResult.rows[0];

  if (!plan.paystack_plan_code) {
    throw new Error(
      "Paystack plan is not configured"
    );
  }

  // -------------------------------------------------------
  // 2. Get user
  // -------------------------------------------------------

  const userResult = await pool.query(
    `
    SELECT
      id,
      email,
      name
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  if ((userResult.rowCount ?? 0) === 0) {
    throw new Error("User not found");
  }

  const user = userResult.rows[0];

  // -------------------------------------------------------
  // 3. Check whether user already has a trial
  // -------------------------------------------------------

  const existingTrial = await pool.query(
    `
    SELECT id
    FROM subscriptions
    WHERE user_id = $1
      AND trial_start_date IS NOT NULL
    LIMIT 1
    `,
    [userId]
  );

  if ((existingTrial.rowCount ?? 0) > 0) {
    throw new Error(
      "User has already used their free trial"
    );
  }

  // -------------------------------------------------------
  // 4. Prevent multiple active subscriptions/trials
  // -------------------------------------------------------

  const existingSubscription = await pool.query(
    `
    SELECT id
    FROM subscriptions
    WHERE user_id = $1
      AND status IN (
        'pending',
        'trialing',
        'active',
        'non-renewing'
      )
    LIMIT 1
    `,
    [userId]
  );

  if ((existingSubscription.rowCount ?? 0) > 0) {
    throw new Error(
      "User already has an active subscription or trial"
    );
  }

  // -------------------------------------------------------
  // 5. Generate unique verification reference
  // -------------------------------------------------------

  const reference =
    `TRIAL-CARD-${userId}-${Date.now()}`;

  // -------------------------------------------------------
  // 6. Calculate trial dates
  // -------------------------------------------------------

  const trialStart = new Date();

  const trialEnd = new Date(
    trialStart.getTime()
  );

  trialEnd.setDate(
    trialEnd.getDate() + TRIAL_DAYS
  );

  // -------------------------------------------------------
  // 7. Initialize small verification transaction
  //
  // IMPORTANT:
  // We DO NOT pass the subscription plan here.
  //
  // Passing the plan would create the subscription
  // immediately after the R1 payment.
  //
  // Instead:
  //
  // R1 card verification
  //       ↓
  // charge.success webhook
  //       ↓
  // save authorization
  //       ↓
  // create subscription with start_date = trialEnd
  // -------------------------------------------------------

  const response = await paystack.post(
    "/transaction/initialize",
    {
      email: user.email,

      amount: CARD_VERIFICATION_AMOUNT,

      currency: "ZAR",

      reference,

      channels: ["card"],

      callback_url:
        process.env.PAYSTACK_TRIAL_RETURN_URL,

      metadata: {
        user_id: userId,
        plan_id: plan.id,
        purpose: "trial_card_verification",
        trial_days: TRIAL_DAYS,
      },
    }
  );

  const transaction =
    response.data.data;

  if (!transaction.authorization_url) {
    throw new Error(
      "Paystack did not return an authorization URL"
    );
  }

  // -------------------------------------------------------
  // 8. Create local trial
  // -------------------------------------------------------

  const subscriptionResult =
    await pool.query(
      `
      INSERT INTO subscriptions (
        user_id,
        plan_id,
        status,
        trial_start_date,
        trial_end_date
      )
      VALUES (
        $1,
        $2,
        'trialing',
        $3,
        $4
      )
      RETURNING id
      `,
      [
        userId,
        plan.id,
        trialStart,
        trialEnd,
      ]
    );

  const subscriptionId =
    subscriptionResult.rows[0].id;

  // -------------------------------------------------------
  // 9. Save the verification transaction
  // -------------------------------------------------------

  await pool.query(
    `
    INSERT INTO payments (
      user_id,
      subscription_id,
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
      $6,
      $7
    )
    `,
    [
      userId,
      subscriptionId,
      reference,
      1.0,
      "ZAR",
      "card_verification",
      "pending",
    ]
  );

  // -------------------------------------------------------
  // 10. Return checkout information
  // -------------------------------------------------------

  return {
    subscriptionId,

    planId: plan.id,

    planName: plan.name,

    priceZar: Number(plan.price_zar),

    trialDays: TRIAL_DAYS,

    trialStart,

    trialEnd,

    reference,

    authorizationUrl:
      transaction.authorization_url,

    accessCode:
      transaction.access_code,
  };
};

// =========================================================
// CREATE PAYSTACK SUBSCRIPTION AFTER CARD VERIFICATION
// =========================================================

export const createPaystackTrialSubscription = async (
  subscriptionId: number
) => {
  // -------------------------------------------------------
  // 1. Get local subscription
  // -------------------------------------------------------

  const result = await pool.query(
    `
    SELECT
      s.id,
      s.user_id,
      s.plan_id,
      s.status,
      s.trial_end_date,
      s.paystack_customer_code,
      s.paystack_authorization_code,

      u.email,

      sp.name AS plan_name,
      sp.paystack_plan_code

    FROM subscriptions s

    JOIN users u
      ON u.id = s.user_id

    JOIN subscription_plans sp
      ON sp.id = s.plan_id

    WHERE s.id = $1
    LIMIT 1
    `,
    [subscriptionId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error(
      "Trial subscription not found"
    );
  }

  const subscription =
    result.rows[0];

  // -------------------------------------------------------
  // 2. Do not create it twice
  // -------------------------------------------------------

  if (
    subscription.paystack_subscription_code
  ) {
    return {
      alreadyCreated: true,

      subscriptionCode:
        subscription.paystack_subscription_code,
    };
  }

  // -------------------------------------------------------
  // 3. Validate customer
  // -------------------------------------------------------

  if (
    !subscription.paystack_customer_code
  ) {
    throw new Error(
      "Paystack customer code is missing"
    );
  }

  // -------------------------------------------------------
  // 4. Validate authorization
  // -------------------------------------------------------

  if (
    !subscription.paystack_authorization_code
  ) {
    throw new Error(
      "Paystack authorization code is missing"
    );
  }

  // -------------------------------------------------------
  // 5. Validate plan
  // -------------------------------------------------------

  if (
    !subscription.paystack_plan_code
  ) {
    throw new Error(
      "Paystack plan code is missing"
    );
  }

  // -------------------------------------------------------
  // 6. Validate trial date
  // -------------------------------------------------------

  if (!subscription.trial_end_date) {
    throw new Error(
      "Trial end date is missing"
    );
  }

  // -------------------------------------------------------
  // 7. Create Paystack subscription
  //
  // Paystack supports start_date when creating a
  // subscription. This allows the first debit to happen
  // after the free-trial period.
  // -------------------------------------------------------

  const response = await paystack.post(
    "/subscription",
    {
      customer:
        subscription.paystack_customer_code,

      plan:
        subscription.paystack_plan_code,

      authorization:
        subscription.paystack_authorization_code,

      start_date:
        new Date(
          subscription.trial_end_date
        ).toISOString(),
    }
  );

  const paystackSubscription =
    response.data.data;

  if (
    !paystackSubscription.subscription_code
  ) {
    throw new Error(
      "Paystack did not return a subscription code"
    );
  }

  // -------------------------------------------------------
  // 8. Save Paystack subscription
  // -------------------------------------------------------

  await pool.query(
    `
    UPDATE subscriptions
    SET
      paystack_subscription_code = $1,
      paystack_email_token = $2,
      status = 'trailing',
      start_date = $3,
      next_payment_date = $4,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $5
    `,
    [
      paystackSubscription.subscription_code,

      paystackSubscription.email_token ??
        null,

      paystackSubscription.start
        ? new Date(
            paystackSubscription.start * 1000
          )
        : subscription.trial_end_date,

      paystackSubscription.next_payment_date
        ? new Date(
            paystackSubscription.next_payment_date
          )
        : subscription.trial_end_date,

      subscriptionId,
    ]
  );

  return paystackSubscription;
};

// =========================================================
// REFUND CARD VERIFICATION CHARGE
// =========================================================

export const refundTrialVerification = async (
  reference: string
) => {
  // -------------------------------------------------------
  // 1. Find payment
  // -------------------------------------------------------

  const result = await pool.query(
    `
    SELECT
      id,
      status,
      payment_type
    FROM payments
    WHERE paystack_reference = $1
    LIMIT 1
    `,
    [reference]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error(
      "Verification payment not found"
    );
  }

  const payment =
    result.rows[0];

  // -------------------------------------------------------
  // 2. Only refund card verification payments
  // -------------------------------------------------------

  if (
    payment.payment_type !==
    "card_verification"
  ) {
    throw new Error(
      "Payment is not a card verification payment"
    );
  }

  // -------------------------------------------------------
  // 3. Only refund successful payments
  // -------------------------------------------------------

  if (
    payment.status !== "successful"
  ) {
    return {
      refunded: false,
      reason: "Payment was not successful",
    };
  }

  // -------------------------------------------------------
  // 4. Request refund from Paystack
  // -------------------------------------------------------

  const response = await paystack.post(
    "/refund",
    {
      transaction: reference,

      amount:
        CARD_VERIFICATION_AMOUNT,

      currency: "ZAR",

      merchant_note:
        "Refund of trial card verification charge",

      customer_note:
        "Your temporary card verification charge has been refunded.",
    }
  );

  return {
    refunded: true,

    refund:
      response.data.data,
  };
};

// =========================================================
// PROCESS EXPIRED TRIALS
// =========================================================
//
// This is a FALLBACK/recovery mechanism.
//
// Normally the subscription should already have been
// created with start_date = trial_end_date.
//
// This function exists in case the subscription creation
// failed or a webhook/process was interrupted.
// =========================================================

export const expireTrials = async () => {
  const result = await pool.query(
    `
    SELECT
      id
    FROM subscriptions
    WHERE status = 'trialing'
      AND trial_end_date IS NOT NULL
      AND trial_end_date <= CURRENT_TIMESTAMP
      AND paystack_subscription_code IS NULL
      AND paystack_authorization_code IS NOT NULL
    ORDER BY trial_end_date ASC
    `
  );

  const processed = [];

  for (const subscription of result.rows) {
    try {
      const paystackSubscription =
        await createPaystackTrialSubscription(
          subscription.id
        );

      processed.push({
        subscriptionId:
          subscription.id,

        status: "active",

        paystackSubscriptionCode:
          paystackSubscription.subscription_code ??
          paystackSubscription.subscriptionCode ??
          null,
      });
    } catch (error) {
      console.error(
        `Failed to activate trial ${subscription.id}`,
        error
      );

      processed.push({
        subscriptionId:
          subscription.id,

        status: "failed",

        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      });
    }
  }

  return processed;
};