import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import pool from "../config/database";

export const paystackWebhookController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // =========================================================
    // 1. VERIFY PAYSTACK SIGNATURE
    // =========================================================

    const signature = req.headers["x-paystack-signature"];

    if (!signature || typeof signature !== "string") {
      return res.status(401).json({
        message: "Missing Paystack signature",
      });
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured");
    }

    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      return res.status(400).json({
        message: "Raw request body is missing",
      });
    }

    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest("hex");

    if (hash !== signature) {
      return res.status(401).json({
        message: "Invalid Paystack signature",
      });
    }

    // =========================================================
    // 2. EVENT INFORMATION
    // =========================================================

    const event = req.body;
    const eventType = event.event;

    if (!eventType) {
      return res.status(400).json({
        message: "Paystack event type is missing",
      });
    }

    const reference =
      event.data?.reference ?? null;

    const transactionId =
      event.data?.id?.toString() ?? null;

    const subscriptionCode =
      event.data?.subscription_code ??
      event.data?.subscription?.subscription_code ??
      null;

    // =========================================================
    // 3. IDEMPOTENT EVENT ID
    // =========================================================

    const eventId = transactionId
      ? `${eventType}:${transactionId}`
      : subscriptionCode
        ? `${eventType}:${subscriptionCode}`
        : event.data?.invoice_code
          ? `${eventType}:${event.data.invoice_code}`
          : `${eventType}:${Date.now()}`;

    // =========================================================
    // 4. SAVE WEBHOOK EVENT
    // =========================================================

    await pool.query(
      `
      INSERT INTO payment_events (
        paystack_event_id,
        event_type,
        reference,
        payload,
        processed
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (paystack_event_id) DO NOTHING
      `,
      [
        eventId,
        eventType,
        reference,
        event,
        false,
      ]
    );

    // =========================================================
    // 5. CHARGE.SUCCESS
    // =========================================================

    if (eventType === "charge.success") {
      const amount = event.data?.amount;
      const currency = event.data?.currency;
      const paidAt = event.data?.paid_at;

      const customerEmail =
        event.data?.customer?.email ?? null;

      const customerCode =
        event.data?.customer?.customer_code ?? null;

      const planCode =
        event.data?.plan?.plan_code ?? null;

      if (
        !reference ||
        amount === undefined ||
        !currency
      ) {
        return res.status(400).json({
          message: "Required payment information is missing",
        });
      }

      // -------------------------------------------------------
      // Check whether application already created payment
      // -------------------------------------------------------

      const existingPayment = await pool.query(
        `
        SELECT
          id,
          user_id,
          subscription_id,
          status
        FROM payments
        WHERE paystack_reference = $1
        LIMIT 1
        `,
        [reference]
      );

      // -------------------------------------------------------
      // INITIAL PAYMENT
      // -------------------------------------------------------

      if ((existingPayment.rowCount ?? 0) > 0) {
        const payment = existingPayment.rows[0];

        const paymentResult = await pool.query(
          `
          UPDATE payments
          SET
            status = 'successful',
            paid_at = COALESCE($1, CURRENT_TIMESTAMP)
          WHERE id = $2
            AND currency = $3
            AND amount_zar * 100 = $4
          RETURNING id
          `,
          [
            paidAt ?? null,
            payment.id,
            currency,
            amount,
          ]
        );

        if ((paymentResult.rowCount ?? 0) === 0) {
          return res.status(400).json({
            message: "Payment amount or currency mismatch",
          });
        }

        // If we already know the subscription,
        // make sure the payment is linked.
        if (!payment.subscription_id && customerCode) {
          await pool.query(
            `
            UPDATE payments p
            SET subscription_id = s.id
            FROM subscriptions s
            WHERE p.id = $1
              AND s.paystack_customer_code = $2
              AND s.status IN (
                'active',
                'non-renewing',
                'attention'
              )
            `,
            [
              payment.id,
              customerCode,
            ]
          );
        }
      }

      // -------------------------------------------------------
      // RECURRING PAYMENT
      // -------------------------------------------------------

      else {
        if (!customerEmail && !customerCode) {
          return res.status(400).json({
            message: "Customer information is missing",
          });
        }

        // Find local subscription
        let subscriptionResult;

        if (customerCode) {
          subscriptionResult = await pool.query(
            `
            SELECT
              s.id,
              s.user_id,
              s.plan_id
            FROM subscriptions s
            WHERE s.paystack_customer_code = $1
              AND s.status IN (
                'active',
                'non-renewing',
                'attention'
              )
            ORDER BY s.created_at DESC
            LIMIT 1
            `,
            [customerCode]
          );
        } else {
          subscriptionResult = await pool.query(
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

        if ((subscriptionResult.rowCount ?? 0) === 0) {
          return res.status(400).json({
            message: "Subscription not found",
          });
        }

        const subscription =
          subscriptionResult.rows[0];

        // Get local plan price
        const planResult = await pool.query(
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

        if ((planResult.rowCount ?? 0) === 0) {
          return res.status(400).json({
            message: "Subscription plan not found",
          });
        }

        const localPlan =
          planResult.rows[0];

        const expectedAmount =
          Number(localPlan.price_zar);

        const actualAmount =
          Number(amount) / 100;

        // Verify amount
        if (actualAmount !== expectedAmount) {
          return res.status(400).json({
            message: "Recurring payment amount mismatch",
          });
        }

        // Verify currency
        if (currency !== "ZAR") {
          return res.status(400).json({
            message: "Invalid payment currency",
          });
        }

        // Verify Paystack plan
        if (
          planCode &&
          planCode !== localPlan.paystack_plan_code
        ) {
          return res.status(400).json({
            message: "Recurring payment plan mismatch",
          });
        }

        // Create recurring payment
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
            COALESCE($6, CURRENT_TIMESTAMP)
          )
          ON CONFLICT (paystack_reference)
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
            reference,
            actualAmount,
            currency,
            paidAt ?? null,
          ]
        );

        // Successful payment means subscription is active
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
      }

      // Mark webhook processed
      await pool.query(
        `
        UPDATE payment_events
        SET processed = true
        WHERE paystack_event_id = $1
        `,
        [eventId]
      );
    }

    // =========================================================
// 6. SUBSCRIPTION.CREATE
// =========================================================

if (eventType === "subscription.create") {
  const subscription = event.data;

  const code =
    subscription?.subscription_code;

  const emailToken =
    subscription?.email_token;

  const status =
    subscription?.status ?? "active";

  const customerCode =
    subscription?.customer?.customer_code;

  const customerEmail =
    subscription?.customer?.email;

  const planCode =
    subscription?.plan?.plan_code;

  const start =
    subscription?.start;

  const nextPaymentDate =
    subscription?.next_payment_date ?? null;

  if (
    !code ||
    !emailToken ||
    !customerCode ||
    !customerEmail ||
    !planCode
  ) {
    return res.status(400).json({
      message:
        "Required subscription information is missing",
    });
  }

  // -------------------------------------------------------
  // Find local plan
  // -------------------------------------------------------

  const planResult = await pool.query(
    `
    SELECT
      id
    FROM subscription_plans
    WHERE paystack_plan_code = $1
      AND active = true
    LIMIT 1
    `,
    [planCode]
  );

  if ((planResult.rowCount ?? 0) === 0) {
    return res.status(400).json({
      message:
        "Subscription plan not found",
    });
  }

  const planId =
    planResult.rows[0].id;

  // -------------------------------------------------------
  // Find local user
  // -------------------------------------------------------

  const userResult = await pool.query(
    `
    SELECT id
    FROM users
    WHERE email = $1
    LIMIT 1
    `,
    [customerEmail]
  );

  if ((userResult.rowCount ?? 0) === 0) {
    return res.status(400).json({
      message: "User not found",
    });
  }

  const userId =
    userResult.rows[0].id;

  // -------------------------------------------------------
  // Find existing local trial
  // -------------------------------------------------------

  const trialResult = await pool.query(
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

  // -------------------------------------------------------
  // EXISTING TRIAL
  // -------------------------------------------------------

  if ((trialResult.rowCount ?? 0) > 0) {
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
          TO_TIMESTAMP($4)
        ),
        next_payment_date = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      `,
      [
        customerCode,
        code,
        emailToken,
        start,
        nextPaymentDate,
        localSubscription.id,
      ]
    );
  }

  // -------------------------------------------------------
  // NO EXISTING TRIAL
  //
  // This covers normal paid subscriptions.
  // -------------------------------------------------------

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
        TO_TIMESTAMP($7),
        $8
      )
      ON CONFLICT (paystack_subscription_code)
      DO UPDATE SET
        paystack_customer_code =
          EXCLUDED.paystack_customer_code,
        paystack_email_token =
          EXCLUDED.paystack_email_token,
        status =
          EXCLUDED.status,
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
        status,
        start,
        nextPaymentDate,
      ]
    );
  }

  // -------------------------------------------------------
  // Mark webhook event processed
  // -------------------------------------------------------

  await pool.query(
    `
    UPDATE payment_events
    SET processed = true
    WHERE paystack_event_id = $1
    `,
    [eventId]
  );
}

    // =========================================================
    // 7. INVOICE.CREATE
    // =========================================================

    if (eventType === "invoice.create") {
      // Paystack sends this before the next billing attempt.
      // Store the event for audit/history.
      // No payment should be marked successful here.

      await pool.query(
        `
        UPDATE payment_events
        SET processed = true
        WHERE paystack_event_id = $1
        `,
        [eventId]
      );
    }

    // =========================================================
    // 8. INVOICE.PAYMENT_FAILED
    // =========================================================

    if (eventType === "invoice.payment_failed") {
      const invoice = event.data;

      const code =
        invoice?.subscription?.subscription_code ??
        invoice?.subscription_code ??
        null;

      const customerCode =
        invoice?.customer?.customer_code ??
        null;

      if (!code && !customerCode) {
        return res.status(400).json({
          message: "Subscription information is missing",
        });
      }

      let subscriptionResult;

      if (code) {
        subscriptionResult = await pool.query(
          `
          SELECT id
          FROM subscriptions
          WHERE paystack_subscription_code = $1
          LIMIT 1
          `,
          [code]
        );
      } else {
        subscriptionResult = await pool.query(
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

      if ((subscriptionResult.rowCount ?? 0) === 0) {
        return res.status(400).json({
          message: "Local subscription not found",
        });
      }

      const subscriptionId =
        subscriptionResult.rows[0].id;

      // Paystack uses "attention" when
      // the subscription charge fails.
      await pool.query(
        `
        UPDATE subscriptions
        SET
          status = 'attention',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [subscriptionId]
      );

      await pool.query(
        `
        UPDATE payment_events
        SET processed = true
        WHERE paystack_event_id = $1
        `,
        [eventId]
      );
    }

    // =========================================================
    // 9. INVOICE.UPDATE
    // =========================================================

    if (eventType === "invoice.update") {
      await pool.query(
        `
        UPDATE payment_events
        SET processed = true
        WHERE paystack_event_id = $1
        `,
        [eventId]
      );
    }

    // =========================================================
    // 10. SUBSCRIPTION.NOT_RENEW
    // =========================================================

    if (eventType === "subscription.not_renew") {
      const subscription = event.data;

      const code =
        subscription?.subscription_code ??
        subscription?.subscription?.subscription_code ??
        null;

      if (!code) {
        return res.status(400).json({
          message: "Subscription code is missing",
        });
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

      await pool.query(
        `
        UPDATE payment_events
        SET processed = true
        WHERE paystack_event_id = $1
        `,
        [eventId]
      );
    }

    // =========================================================
    // 11. SUBSCRIPTION.DISABLE
    // =========================================================

    if (eventType === "subscription.disable") {
      const subscription = event.data;

      const code =
        subscription?.subscription_code ??
        subscription?.subscription?.subscription_code ??
        null;

      const paystackStatus =
        subscription?.status ?? null;

      if (!code) {
        return res.status(400).json({
          message: "Subscription code is missing",
        });
      }

      const localStatus =
        paystackStatus === "complete"
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

      await pool.query(
        `
        UPDATE payment_events
        SET processed = true
        WHERE paystack_event_id = $1
        `,
        [eventId]
      );
    }

    // =========================================================
    // 12. EXPIRING CARDS
    // =========================================================

    if (eventType === "subscription.expiring_cards") {
      await pool.query(
        `
        UPDATE payment_events
        SET processed = true
        WHERE paystack_event_id = $1
        `,
        [eventId]
      );
    }

   // =========================================================
// ZERO-CHARGE AUTHORIZATION SUCCESS
// =========================================================

if (
  eventType ===
  "zero_charge_authorization.success"
) {
  const authorization =
    event.data?.authorization;

  const authorizationCode =
    authorization?.authorization_code ??
    null;

  const customerCode =
    event.data?.customer?.customer_code ??
    null;

  const customerEmail =
    event.data?.customer?.email ??
    null;

  if (!authorizationCode) {
    return res.status(400).json({
      message:
        "Authorization code is missing",
    });
  }

  if (!customerCode) {
    return res.status(400).json({
      message:
        "Customer code is missing",
    });
  }

  if (
  authorization?.reusable !== true
) {
  return res.status(400).json({
    message:
      "Paystack authorization is not reusable",
  });
}

  // -------------------------------------------------------
  // Find the user's active trial
  // -------------------------------------------------------

  let trialResult;

  if (customerEmail) {
    trialResult = await pool.query(
      `
      SELECT
        s.id
      FROM subscriptions s
      JOIN users u
        ON u.id = s.user_id
      WHERE u.email = $1
        AND s.status = 'trialing'
        AND s.trial_start_date IS NOT NULL
        AND s.trial_end_date > CURRENT_TIMESTAMP
      ORDER BY s.created_at DESC
      LIMIT 1
      `,
      [customerEmail]
    );
  }

  if (
    !trialResult ||
    (trialResult.rowCount ?? 0) === 0
  ) {
    return res.status(400).json({
      message:
        "Active trial subscription not found",
    });
  }

  const subscriptionId =
    trialResult.rows[0].id;

  // -------------------------------------------------------
  // Save reusable authorization
  // -------------------------------------------------------

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

  // -------------------------------------------------------
  // Mark webhook processed
  // -------------------------------------------------------

  await pool.query(
    `
    UPDATE payment_events
    SET processed = true
    WHERE paystack_event_id = $1
    `,
    [eventId]
  );
}

    // =========================================================
    // 14. ACKNOWLEDGE PAYSTACK
    // =========================================================

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    next(error);
  }
};