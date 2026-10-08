import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

import pool from "../config/database";
import {
  createPaystackTrialSubscription,
  refundTrialVerification,
} from "../services/trial.service";

// =========================================================
// PAYSTACK WEBHOOK CONTROLLER
// =========================================================

export const paystackWebhookController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // =====================================================
    // 1. VERIFY PAYSTACK SIGNATURE
    // =====================================================

    const signature =
      req.headers["x-paystack-signature"];

    if (
      !signature ||
      typeof signature !== "string"
    ) {
      return res.status(401).json({
        message: "Missing Paystack signature",
      });
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      throw new Error(
        "PAYSTACK_SECRET_KEY is not configured"
      );
    }

    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      return res.status(400).json({
        message:
          "Raw request body is missing",
      });
    }

    const hash = crypto
      .createHmac(
        "sha512",
        process.env.PAYSTACK_SECRET_KEY
      )
      .update(rawBody)
      .digest("hex");

    if (hash !== signature) {
      return res.status(401).json({
        message:
          "Invalid Paystack signature",
      });
    }

    // =====================================================
    // 2. EVENT INFORMATION
    // =====================================================

    const event = req.body;

    const eventType =
      event?.event;

    if (!eventType) {
      return res.status(400).json({
        message:
          "Paystack event type is missing",
      });
    }

    const reference =
      event.data?.reference ??
      null;

    const transactionId =
      event.data?.id?.toString() ??
      null;

    const subscriptionCode =
      event.data?.subscription_code ??
      event.data?.subscription
        ?.subscription_code ??
      null;

    const invoiceCode =
      event.data?.invoice_code ??
      null;

    // =====================================================
    // 3. CREATE STABLE EVENT ID
    // =====================================================

    const eventIdentifier =
      transactionId ??
      subscriptionCode ??
      invoiceCode ??
      crypto
        .createHash("sha256")
        .update(rawBody)
        .digest("hex");

    const eventId =
      `${eventType}:${eventIdentifier}`;

    // =====================================================
    // 4. SAVE WEBHOOK EVENT
    // =====================================================

    const insertEventResult =
      await pool.query(
        `
        INSERT INTO payment_events (
          paystack_event_id,
          event_type,
          reference,
          payload,
          processed
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5
        )
        ON CONFLICT (
          paystack_event_id
        )
        DO NOTHING
        RETURNING id
        `,
        [
          eventId,
          eventType,
          reference,
          event,
          false,
        ]
      );

    // =====================================================
    // 5. IDEMPOTENCY
    // =====================================================

    if (
      (insertEventResult.rowCount ?? 0) === 0
    ) {
      return res.status(200).json({
        received: true,
        duplicate: true,
      });
    }

    // =====================================================
    // 6. CHARGE.SUCCESS
    // =====================================================

    if (
      eventType === "charge.success"
    ) {
      await handleChargeSuccess(
        event,
        eventId
      );

      return res.status(200).json({
        received: true,
      });
    }

    // =====================================================
    // 7. SUBSCRIPTION.CREATE
    // =====================================================

    if (
      eventType ===
      "subscription.create"
    ) {
      await handleSubscriptionCreate(
        event,
        eventId
      );

      return res.status(200).json({
        received: true,
      });
    }

    // =====================================================
    // 8. INVOICE.CREATE
    // =====================================================

    if (
      eventType === "invoice.create"
    ) {
      await markEventProcessed(
        eventId
      );

      return res.status(200).json({
        received: true,
      });
    }

    // =====================================================
    // 9. INVOICE.UPDATE
    // =====================================================

    if (
      eventType === "invoice.update"
    ) {
      await markEventProcessed(
        eventId
      );

      return res.status(200).json({
        received: true,
      });
    }

    // =====================================================
    // 10. INVOICE.PAYMENT_FAILED
    // =====================================================

    if (
      eventType ===
      "invoice.payment_failed"
    ) {
      await handleInvoicePaymentFailed(
        event,
        eventId
      );

      return res.status(200).json({
        received: true,
      });
    }

    // =====================================================
    // 11. SUBSCRIPTION.NOT_RENEW
    // =====================================================

    if (
      eventType ===
      "subscription.not_renew"
    ) {
      await handleSubscriptionNotRenew(
        event,
        eventId
      );

      return res.status(200).json({
        received: true,
      });
    }

    // =====================================================
    // 12. SUBSCRIPTION.DISABLE
    // =====================================================

    if (
      eventType ===
      "subscription.disable"
    ) {
      await handleSubscriptionDisable(
        event,
        eventId
      );

      return res.status(200).json({
        received: true,
      });
    }

    // =====================================================
    // 13. SUBSCRIPTION.EXPIRING_CARDS
    // =====================================================

    if (
      eventType ===
      "subscription.expiring_cards"
    ) {
      await markEventProcessed(
        eventId
      );

      return res.status(200).json({
        received: true,
      });
    }

    // =====================================================
    // 14. CARD VERIFICATION FAILED
    // =====================================================

    if (
      eventType ===
      "card_verification.failed"
    ) {
      await handleCardVerificationFailed(
        event,
        eventId
      );

      return res.status(200).json({
        received: true,
      });
    }

    // =====================================================
    // 15. UNKNOWN EVENT
    // =====================================================

    await markEventProcessed(
      eventId
    );

    return res.status(200).json({
      received: true,
      ignored: true,
      event: eventType,
    });
  } catch (error) {
    next(error);
  }
};

// =========================================================
// HANDLE CHARGE.SUCCESS
// =========================================================

const handleChargeSuccess = async (
  event: any,
  eventId: string
) => {
  const data = event.data;

  const reference =
    data?.reference;

  const amount =
    data?.amount;

  const currency =
    data?.currency;

  const paidAt =
    data?.paid_at ??
    null;

  if (
    !reference ||
    amount === undefined ||
    !currency
  ) {
    throw new Error(
      "Required payment information is missing"
    );
  }

  // =======================================================
  // FIND LOCAL PAYMENT
  // =======================================================

  const paymentResult =
    await pool.query(
      `
      SELECT
        id,
        user_id,
        subscription_id,
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
      `Payment record not found for reference ${reference}`
    );
  }

  const payment =
    paymentResult.rows[0];

  // =======================================================
  // VERIFY CURRENCY
  // =======================================================

  if (
    currency !== payment.currency
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
      Number(payment.amount_zar) *
        100
    );

  if (
    Number(amount) !==
    expectedAmount
  ) {
    throw new Error(
      "Payment amount does not match"
    );
  }

  // =======================================================
  // TRIAL CARD VERIFICATION
  // =======================================================

  if (
    payment.payment_type ===
    "card_verification"
  ) {
    await handleTrialCardVerification(
      payment,
      data,
      eventId
    );

    return;
  }

  // =======================================================
  // NORMAL PAYMENT
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
      paidAt,
      payment.id,
    ]
  );

  // =======================================================
  // RECURRING SUBSCRIPTION PAYMENT
  // =======================================================

  if (
    payment.payment_type ===
    "subscription"
  ) {
    await handleRecurringPayment(
      payment,
      data
    );
  }

  // =======================================================
  // MARK EVENT PROCESSED
  // =======================================================

  await markEventProcessed(
    eventId
  );
};

// =========================================================
// HANDLE TRIAL CARD VERIFICATION
// =========================================================

const handleTrialCardVerification =
  async (
    payment: any,
    data: any,
    eventId: string
  ) => {
    const subscriptionId =
      payment.subscription_id;

    if (!subscriptionId) {
      throw new Error(
        "Trial payment is not linked to a subscription"
      );
    }

    const authorizationCode =
      data?.authorization
        ?.authorization_code ??
      null;

    const customerCode =
      data?.customer?.customer_code ??
      data?.customer?.code ??
      null;

    if (!authorizationCode) {
      throw new Error(
        "Paystack authorization code is missing"
      );
    }

    if (!customerCode) {
      throw new Error(
        "Paystack customer code is missing"
      );
    }

    // =======================================================
    // SAVE CARD AUTHORIZATION
    // =======================================================

    await pool.query(
      `
      UPDATE subscriptions
      SET
        paystack_customer_code = $1,
        paystack_authorization_code = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      `,
      [
        customerCode,
        authorizationCode,
        subscriptionId,
      ]
    );

    // =======================================================
    // MARK R1 PAYMENT SUCCESSFUL
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
        data?.paid_at ??
          null,
        payment.id,
      ]
    );

    // =======================================================
    // REFUND R1 VERIFICATION PAYMENT
    // =======================================================

    try {
      await refundTrialVerification(
        data.reference
      );
    } catch (refundError) {
      console.error(
        "Trial card verification refund failed:",
        refundError
      );
    }

    // =======================================================
    // CREATE PAYSTACK SUBSCRIPTION
    // =======================================================

    await createPaystackTrialSubscription(
      subscriptionId
    );

    // =======================================================
    // MARK EVENT PROCESSED
    // =======================================================

    await markEventProcessed(
      eventId
    );
  };

// =========================================================
// HANDLE RECURRING PAYMENT
// =========================================================

const handleRecurringPayment = async (
  payment: any,
  data: any
) => {
  let subscriptionResult;

  const customerCode =
    data?.customer?.customer_code ??
    data?.customer?.code ??
    null;

  const customerEmail =
    data?.customer?.email ??
    null;

  // -------------------------------------------------------
  // Find by Paystack customer code first
  // -------------------------------------------------------

  if (customerCode) {
    subscriptionResult =
      await pool.query(
        `
        SELECT
          s.id,
          s.user_id,
          s.plan_id
        FROM subscriptions s
        WHERE s.paystack_customer_code = $1
          AND s.status IN (
            'trialing',
            'active',
            'non-renewing',
            'attention'
          )
        ORDER BY s.created_at DESC
        LIMIT 1
        `,
        [customerCode]
      );
  }

  // -------------------------------------------------------
  // Fallback to email
  // -------------------------------------------------------

  if (
    (!subscriptionResult ||
      (subscriptionResult.rowCount ?? 0) === 0) &&
    customerEmail
  ) {
    subscriptionResult =
      await pool.query(
        `
        SELECT
          s.id,
          s.user_id,
          s.plan_id
        FROM subscriptions s
        JOIN users u
          ON u.id = s.user_id
        WHERE u.email = $1
          AND s.status IN (
            'trialing',
            'active',
            'non-renewing',
            'attention'
          )
        ORDER BY s.created_at DESC
        LIMIT 1
        `,
        [customerEmail]
      );
  }

  if (
    !subscriptionResult ||
    (subscriptionResult.rowCount ?? 0) === 0
  ) {
    throw new Error(
      "Subscription not found for recurring payment"
    );
  }

  const subscription =
    subscriptionResult.rows[0];

  // =======================================================
  // GET LOCAL PLAN
  // =======================================================

  const planResult =
    await pool.query(
      `
      SELECT
        id,
        price_zar,
        paystack_plan_code
      FROM subscription_plans
      WHERE id = $1
        AND active = true
      LIMIT 1
      `,
      [subscription.plan_id]
    );

  if (
    (planResult.rowCount ?? 0) === 0
  ) {
    throw new Error(
      "Subscription plan not found"
    );
  }

  const localPlan =
    planResult.rows[0];

  const expectedAmount =
    Number(localPlan.price_zar);

  const actualAmount =
    Number(data.amount) / 100;

  // =======================================================
  // VERIFY AMOUNT
  // =======================================================

  if (
    actualAmount !== expectedAmount
  ) {
    throw new Error(
      "Recurring payment amount mismatch"
    );
  }

  // =======================================================
  // VERIFY CURRENCY
  // =======================================================

  if (
    data.currency !== "ZAR"
  ) {
    throw new Error(
      "Invalid recurring payment currency"
    );
  }

  // =======================================================
  // VERIFY PLAN
  // =======================================================

  const planCode =
    data?.plan?.plan_code ??
    null;

  if (
    planCode &&
    planCode !==
      localPlan.paystack_plan_code
  ) {
    throw new Error(
      "Recurring payment plan mismatch"
    );
  }

  // =======================================================
  // SAVE RECURRING PAYMENT
  // =======================================================

  await pool.query(
    `
    INSERT INTO payments (
      user_id,
      subscription_id,
      paystack_reference,
      amount_zar,
      currency,
      payment_type,
      status,
      paid_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      'subscription',
      'successful',
      COALESCE(
        $6,
        CURRENT_TIMESTAMP
      )
    )
    ON CONFLICT (
      paystack_reference
    )
    DO UPDATE SET
      status = 'successful',
      paid_at = COALESCE(
        EXCLUDED.paid_at,
        CURRENT_TIMESTAMP
      )
    `,
    [
      subscription.user_id,
      subscription.id,
      data.reference,
      actualAmount,
      data.currency,
      data.paid_at ??
        null,
    ]
  );

  // =======================================================
  // ACTIVATE SUBSCRIPTION
  // =======================================================

  await pool.query(
    `
    UPDATE subscriptions
    SET
      status = 'active',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [subscription.id]
  );
};

// =========================================================
// HANDLE SUBSCRIPTION.CREATE
// =========================================================

const handleSubscriptionCreate =
  async (
    event: any,
    eventId: string
  ) => {
    const subscription =
      event.data;

    const code =
      subscription?.subscription_code ??
      null;

    const emailToken =
      subscription?.email_token ??
      null;

    const paystackStatus =
      subscription?.status ??
      "active";

    const customerCode =
      subscription?.customer
        ?.customer_code ??
      subscription?.customer
        ?.code ??
      null;

    const customerEmail =
      subscription?.customer
        ?.email ??
      null;

    const planCode =
      subscription?.plan
        ?.plan_code ??
      null;

    const start =
      subscription?.start ??
      null;

    const nextPaymentDate =
      subscription
        ?.next_payment_date ??
      null;

    if (!code) {
      throw new Error(
        "Subscription code is missing"
      );
    }

    if (!customerCode) {
      throw new Error(
        "Paystack customer code is missing"
      );
    }

    if (!customerEmail) {
      throw new Error(
        "Customer email is missing"
      );
    }

    if (!planCode) {
      throw new Error(
        "Paystack plan code is missing"
      );
    }

    // =====================================================
    // FIND LOCAL PLAN
    // =====================================================

    const planResult =
      await pool.query(
        `
        SELECT id
        FROM subscription_plans
        WHERE paystack_plan_code = $1
          AND active = true
        LIMIT 1
        `,
        [planCode]
      );

    if (
      (planResult.rowCount ?? 0) === 0
    ) {
      throw new Error(
        "Subscription plan not found"
      );
    }

    const planId =
      planResult.rows[0].id;

    // =====================================================
    // FIND USER
    // =====================================================

    const userResult =
      await pool.query(
        `
        SELECT id
        FROM users
        WHERE email = $1
        LIMIT 1
        `,
        [customerEmail]
      );

    if (
      (userResult.rowCount ?? 0) === 0
    ) {
      throw new Error(
        "User not found"
      );
    }

    const userId =
      userResult.rows[0].id;

    // =====================================================
    // CHECK FOR TRIAL
    // =====================================================

    const trialResult =
      await pool.query(
        `
        SELECT
          id,
          status,
          trial_start_date,
          trial_end_date
        FROM subscriptions
        WHERE user_id = $1
          AND plan_id = $2
          AND status = 'trialing'
          AND trial_start_date IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [
          userId,
          planId,
        ]
      );

    // =====================================================
    // EXISTING TRIAL
    // =====================================================

    if (
      (trialResult.rowCount ?? 0) > 0
    ) {
      const localSubscription =
        trialResult.rows[0];

      await pool.query(
        `
        UPDATE subscriptions
        SET
          paystack_customer_code = $1,
          paystack_subscription_code = $2,
          paystack_email_token = $3,
          status = 'trialing',
          start_date = COALESCE(
            start_date,
            $4
          ),
          next_payment_date = COALESCE(
            $5,
            next_payment_date
          ),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
        `,
        [
          customerCode,
          code,
          emailToken,
          start
            ? new Date(
                Number(start) *
                  1000
              )
            : null,
          nextPaymentDate,
          localSubscription.id,
        ]
      );
    }

    // =====================================================
    // NORMAL PAID SUBSCRIPTION
    // =====================================================

    else {
      await pool.query(
        `
        INSERT INTO subscriptions (
          user_id,
          plan_id,
          paystack_customer_code,
          paystack_subscription_code,
          paystack_email_token,
          status,
          start_date,
          next_payment_date
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8
        )
        ON CONFLICT (
          paystack_subscription_code
        )
        DO UPDATE SET
          paystack_customer_code =
            EXCLUDED.paystack_customer_code,

          paystack_email_token =
            EXCLUDED.paystack_email_token,

          status =
            CASE
              WHEN subscriptions.status =
                'trialing'
              THEN 'trialing'
              ELSE EXCLUDED.status
            END,

          next_payment_date =
            EXCLUDED.next_payment_date,

          updated_at =
            CURRENT_TIMESTAMP
        `,
        [
          userId,
          planId,
          customerCode,
          code,
          emailToken,
          paystackStatus,
          start
            ? new Date(
                Number(start) *
                  1000
              )
            : null,
          nextPaymentDate,
        ]
      );
    }

    await markEventProcessed(
      eventId
    );
  };

// =========================================================
// HANDLE INVOICE PAYMENT FAILED
// =========================================================

const handleInvoicePaymentFailed =
  async (
    event: any,
    eventId: string
  ) => {
    const invoice =
      event.data;

    const code =
      invoice?.subscription
        ?.subscription_code ??
      invoice?.subscription_code ??
      null;

    const customerCode =
      invoice?.customer
        ?.customer_code ??
      invoice?.customer
        ?.code ??
      null;

    if (
      !code &&
      !customerCode
    ) {
      throw new Error(
        "Subscription information is missing"
      );
    }

    let result;

    if (code) {
      result =
        await pool.query(
          `
          SELECT id
          FROM subscriptions
          WHERE paystack_subscription_code = $1
          LIMIT 1
          `,
          [code]
        );
    } else {
      result =
        await pool.query(
          `
          SELECT id
          FROM subscriptions
          WHERE paystack_customer_code = $1
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [customerCode]
        );
    }

    if (
      (result.rowCount ?? 0) === 0
    ) {
      throw new Error(
        "Local subscription not found"
      );
    }

    await pool.query(
      `
      UPDATE subscriptions
      SET
        status = 'attention',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [result.rows[0].id]
    );

    await markEventProcessed(
      eventId
    );
  };

// =========================================================
// HANDLE SUBSCRIPTION NOT RENEW
// =========================================================

const handleSubscriptionNotRenew =
  async (
    event: any,
    eventId: string
  ) => {
    const subscription =
      event.data;

    const code =
      subscription
        ?.subscription_code ??
      subscription
        ?.subscription
        ?.subscription_code ??
      null;

    if (!code) {
      throw new Error(
        "Subscription code is missing"
      );
    }

    await pool.query(
      `
      UPDATE subscriptions
      SET
        status = 'non-renewing',
        cancelled_at = COALESCE(
          cancelled_at,
          CURRENT_TIMESTAMP
        ),
        updated_at = CURRENT_TIMESTAMP
      WHERE paystack_subscription_code = $1
      `,
      [code]
    );

    await markEventProcessed(
      eventId
    );
  };

// =========================================================
// HANDLE SUBSCRIPTION DISABLE
// =========================================================

const handleSubscriptionDisable =
  async (
    event: any,
    eventId: string
  ) => {
    const subscription =
      event.data;

    const code =
      subscription
        ?.subscription_code ??
      subscription
        ?.subscription
        ?.subscription_code ??
      null;

    const paystackStatus =
      subscription?.status ??
      null;

    if (!code) {
      throw new Error(
        "Subscription code is missing"
      );
    }

    const localStatus =
      paystackStatus ===
      "complete"
        ? "completed"
        : "cancelled";

    await pool.query(
      `
      UPDATE subscriptions
      SET
        status = $1,
        cancelled_at = COALESCE(
          cancelled_at,
          CURRENT_TIMESTAMP
        ),
        updated_at = CURRENT_TIMESTAMP
      WHERE paystack_subscription_code = $2
      `,
      [
        localStatus,
        code,
      ]
    );

    await markEventProcessed(
      eventId
    );
  };

// =========================================================
// HANDLE CARD VERIFICATION FAILED
// =========================================================

const handleCardVerificationFailed =
  async (
    event: any,
    eventId: string
  ) => {
    const reference =
      event.data?.reference ??
      null;

    if (!reference) {
      await markEventProcessed(
        eventId
      );

      return;
    }

    await pool.query(
      `
      UPDATE payments
      SET
        status = 'failed'
      WHERE paystack_reference = $1
      `,
      [reference]
    );

    const paymentResult =
      await pool.query(
        `
        SELECT
          subscription_id
        FROM payments
        WHERE paystack_reference = $1
        LIMIT 1
        `,
        [reference]
      );

    if (
      (paymentResult.rowCount ?? 0) > 0 &&
      paymentResult.rows[0]
        .subscription_id
    ) {
      await pool.query(
        `
        UPDATE subscriptions
        SET
          status = 'cancelled',
          cancelled_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [
          paymentResult.rows[0]
            .subscription_id,
        ]
      );
    }

    await markEventProcessed(
      eventId
    );
  };

// =========================================================
// MARK EVENT PROCESSED
// =========================================================

const markEventProcessed = async (
  eventId: string
) => {
  await pool.query(
    `
    UPDATE payment_events
    SET
      processed = true
    WHERE paystack_event_id = $1
    `,
    [eventId]
  );
};