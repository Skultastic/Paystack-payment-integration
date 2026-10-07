import pool from "../config/database";
import paystack from "../config/paystack";

// =========================================================
// GET CURRENT SUBSCRIPTION
// =========================================================

export const getUserSubscription = async (
  userId: number
) => {
  const result = await pool.query(
    `
    SELECT
      s.id,
      s.user_id,
      s.plan_id,
      s.status,

      s.paystack_customer_code,
      s.paystack_subscription_code,

      s.start_date,
      s.next_payment_date,

      s.trial_start_date,
      s.trial_end_date,

      s.cancelled_at,

      s.created_at,
      s.updated_at,

      sp.name AS plan_name,
      sp.price_zar,
      sp.billing_interval

    FROM subscriptions s

    JOIN subscription_plans sp
      ON sp.id = s.plan_id

    WHERE s.user_id = $1

    ORDER BY s.created_at DESC

    LIMIT 1
    `,
    [userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  const subscription = result.rows[0];

  // -------------------------------------------------------
  // Check whether local trial has expired
  // -------------------------------------------------------

  if (
    subscription.status === "trialing" &&
    subscription.trial_end_date &&
    new Date(subscription.trial_end_date) <=
      new Date()
  ) {
    subscription.trialExpired = true;
  } else {
    subscription.trialExpired = false;
  }

  return subscription;
};

// =========================================================
// CANCEL SUBSCRIPTION
// =========================================================

export const cancelSubscription = async (
  subscriptionId: number,
  userId: number
) => {
  // -------------------------------------------------------
  // Find subscription
  // -------------------------------------------------------

  const result = await pool.query(
    `
    SELECT
      id,
      user_id,
      status,
      paystack_subscription_code,
      paystack_email_token
    FROM subscriptions
    WHERE id = $1
      AND user_id = $2
    LIMIT 1
    `,
    [
      subscriptionId,
      userId,
    ]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error(
      "Subscription not found"
    );
  }

  const subscription =
    result.rows[0];

  // -------------------------------------------------------
  // Already cancelled
  // -------------------------------------------------------

  if (
    subscription.status ===
      "cancelled" ||
    subscription.status ===
      "completed"
  ) {
    throw new Error(
      "Subscription is already inactive"
    );
  }

  // -------------------------------------------------------
  // Trial without Paystack subscription
  // -------------------------------------------------------

  if (
    subscription.status ===
      "trialing" &&
    !subscription.paystack_subscription_code
  ) {
    await pool.query(
      `
      UPDATE subscriptions
      SET
        status = 'cancelled',
        cancelled_at =
          CURRENT_TIMESTAMP,
        updated_at =
          CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [subscriptionId]
    );

    return {
      success: true,
      status: "cancelled",
      message:
        "Trial cancelled successfully",
    };
  }

  // -------------------------------------------------------
  // Paystack subscription
  // -------------------------------------------------------

  if (
    !subscription.paystack_subscription_code
  ) {
    throw new Error(
      "Paystack subscription code is missing"
    );
  }

  if (
    !subscription.paystack_email_token
  ) {
    throw new Error(
      "Paystack email token is missing"
    );
  }

  // -------------------------------------------------------
  // Disable Paystack subscription
  // -------------------------------------------------------

  await paystack.post(
    "/subscription/disable",
    {
      code:
        subscription.paystack_subscription_code,

      token:
        subscription.paystack_email_token,
    }
  );

  // -------------------------------------------------------
  // Update local subscription
  // -------------------------------------------------------

  await pool.query(
    `
    UPDATE subscriptions
    SET
      status = 'non-renewing',
      cancelled_at =
        COALESCE(
          cancelled_at,
          CURRENT_TIMESTAMP
        ),
      updated_at =
        CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [subscriptionId]
  );

  return {
    success: true,

    status: "non-renewing",

    message:
      "Subscription cancelled successfully",
  };
};

// =========================================================
// ENABLE SUBSCRIPTION
// =========================================================

export const enableSubscription = async (
  subscriptionId: number,
  userId: number
) => {
  const result = await pool.query(
    `
    SELECT
      id,
      user_id,
      status,
      paystack_subscription_code,
      paystack_email_token
    FROM subscriptions
    WHERE id = $1
      AND user_id = $2
    LIMIT 1
    `,
    [
      subscriptionId,
      userId,
    ]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error(
      "Subscription not found"
    );
  }

  const subscription =
    result.rows[0];

  if (
    !subscription.paystack_subscription_code
  ) {
    throw new Error(
      "Paystack subscription code is missing"
    );
  }

  if (
    !subscription.paystack_email_token
  ) {
    throw new Error(
      "Paystack email token is missing"
    );
  }

  // -------------------------------------------------------
  // Enable Paystack subscription
  // -------------------------------------------------------

  await paystack.post(
    "/subscription/enable",
    {
      code:
        subscription.paystack_subscription_code,

      token:
        subscription.paystack_email_token,
    }
  );

  // -------------------------------------------------------
  // Update local state
  // -------------------------------------------------------

  await pool.query(
    `
    UPDATE subscriptions
    SET
      status = 'active',
      cancelled_at = NULL,
      updated_at =
        CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [subscriptionId]
  );

  return {
    success: true,

    status: "active",

    message:
      "Subscription enabled successfully",
  };
};