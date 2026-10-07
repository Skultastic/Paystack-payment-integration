import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import pool from "../config/database";

export const paystackWebhookController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get the signature Paystack sent with the webhook
    const signature = req.headers["x-paystack-signature"];

    // Make sure Paystack actually sent a signature
    if (!signature || typeof signature !== "string") {
      return res.status(401).json({
        message: "Missing Paystack signature",
      });
    }

    // Make sure our Paystack secret key exists
    if (!process.env.PAYSTACK_SECRET_KEY) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured");
    }

    // Use the exact raw body Paystack sent
    const rawBody = (req as any).rawBody;

    // Generate our own HMAC-SHA512 signature
    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest("hex");

    // Compare our signature with Paystack's signature
    if (hash !== signature) {
      return res.status(401).json({
        message: "Invalid Paystack signature",
      });
    }

    // The webhook is authentic
    const event = req.body;

    // Get the Paystack event ID
    const eventId = event.data?.id?.toString();

    // Get the event type
    const eventType = event.event;

    // Get the transaction reference if one exists
    const reference = event.data?.reference ?? null;

    // Make sure the event has an ID
    if (!eventId) {
      return res.status(400).json({
        message: "Webhook event ID is missing",
      });
    }

    // Save the event in PostgreSQL
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

    // Tell Paystack we received the event
    res.status(200).json({
      received: true,
    });

  } catch (error) {
    // Pass unexpected errors to the error middleware
    next(error);
  }
};