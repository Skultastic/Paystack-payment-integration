import pool from "../config/database";
import paystack from "../config/paystack";

// =========================================================
// START TRIAL
// =========================================================

export const startTrial = async (
  userId: number,
  planId: number
) => {
  // -------------------------------------------------------
  // 1. Find selected plan
  // -------------------------------------------------------

  const planResult = await pool.query(
    `
    SELECT
      id,
      name,
      price_zar,
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
  // 3. Check whether trial was already used
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
  // 4. Generate unique reference
  // -------------------------------------------------------

  const reference =
    `TRIAL-${userId}-${Date.now()}`;

  // -------------------------------------------------------
  // 5. Initialize Paystack card authorization
  //
  // This verifies/tokenizes the card.
  // It does NOT start the monthly subscription.
  // -------------------------------------------------------

  const response = await paystack.post(
    "/customer/authorization/initialize",
    {
      customer: {
        email: user.email,
        first_name: user.name,
      },

      currency: "ZAR",

      channel: "card",

      purpose: "ADD_CARD",

      recurring_consent: true,

      return_url:
        process.env.PAYSTACK_TRIAL_RETURN_URL,
    }
  );

  const authorizationData =
    response.data.data;

  // -------------------------------------------------------
  // 6. Create local trial
  // -------------------------------------------------------

  const trialStart = new Date();

  const trialEnd = new Date(
    trialStart
  );

  trialEnd.setDate(
    trialEnd.getDate() + 3
  );

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
  // 7. Return authorization information
  // -------------------------------------------------------

  return {
    subscriptionId,

    planId: plan.id,

    planName: plan.name,

    trialStart,

    trialEnd,

    reference,

    authorizationUrl:
      authorizationData.authorization_url ??
      authorizationData.url ??
      null,

    accessCode:
      authorizationData.access_code ??
      null,
  };
};

// =========================================================
// CREATE PAYSTACK SUBSCRIPTION AFTER TRIAL
// =========================================================

export const createPaystackTrialSubscription = async (
  subscriptionId: number
) => {
  // -------------------------------------------------------
  // 1. Get trial
  // -------------------------------------------------------

  const result = await pool.query(
    `
    SELECT
      s.id,
      s.user_id,
      s.plan_id,
      s.trial_end_date,
      s.paystack_customer_code,
      s.paystack_authorization_code,

      sp.paystack_plan_code

    FROM subscriptions s

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
  // 2. Validate Paystack details
  // -------------------------------------------------------

  if (
    !subscription.paystack_customer_code
  ) {
    throw new Error(
      "Paystack customer code is missing"
    );
  }

  if (
    !subscription.paystack_authorization_code
  ) {
    throw new Error(
      "Paystack authorization code is missing"
    );
  }

  if (
    !subscription.paystack_plan_code
  ) {
    throw new Error(
      "Paystack plan code is missing"
    );
  }

  // -------------------------------------------------------
  // 3. Create Paystack subscription
  //
  // The customer is subscribed to the existing plan
  // using the authorization obtained during verification.
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
    }
  );

  const paystackSubscription =
    response.data.data;

  // -------------------------------------------------------
  // 4. Save Paystack subscription
  // -------------------------------------------------------

  await pool.query(
    `
    UPDATE subscriptions
    SET
      paystack_subscription_code = $1,
      paystack_email_token = $2,
      status = 'active',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    `,
    [
      paystackSubscription.subscription_code,
      paystackSubscription.email_token,
      subscriptionId,
    ]
  );

  return paystackSubscription;
};

// =========================================================
// PROCESS EXPIRED TRIALS
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
          paystackSubscription.subscription_code,
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
      });
    }
  }

  return processed;
};