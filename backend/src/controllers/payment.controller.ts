import {
  Request,
  Response,
  NextFunction,
} from "express";

import {
  initializePayment,
  verifyPayment,
} from "../services/payment.service";

// =========================================================
// INITIALIZE PAYMENT
// =========================================================

export const initializePaymentController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      email,
      planId,
      userId,
    } = req.body;

    // -------------------------------------------------------
    // Validate email
    // -------------------------------------------------------

    if (
      !email ||
      typeof email !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Valid email is required",
      });
    }

    // -------------------------------------------------------
    // Validate planId
    // -------------------------------------------------------

    const parsedPlanId =
      Number(planId);

    if (
      !Number.isInteger(
        parsedPlanId
      ) ||
      parsedPlanId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Valid planId is required",
      });
    }

    // -------------------------------------------------------
    // Validate userId
    // -------------------------------------------------------

    const parsedUserId =
      Number(userId);

    if (
      !Number.isInteger(
        parsedUserId
      ) ||
      parsedUserId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Valid userId is required",
      });
    }

    // -------------------------------------------------------
    // Initialize Paystack payment
    // -------------------------------------------------------

    const payment =
      await initializePayment(
        email.trim(),
        parsedPlanId,
        parsedUserId
      );

    // -------------------------------------------------------
    // Return Paystack checkout details
    // -------------------------------------------------------

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    next(error);
  }
};

// =========================================================
// VERIFY PAYMENT
// =========================================================

export const verifyPaymentController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const reference =
      req.params.reference;

    // -------------------------------------------------------
    // Validate reference
    // -------------------------------------------------------

    if (
      !reference ||
      typeof reference !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Payment reference is required",
      });
    }

    // -------------------------------------------------------
    // Verify payment with Paystack
    // -------------------------------------------------------

    const payment =
      await verifyPayment(
        reference.trim()
      );

    // -------------------------------------------------------
    // Return verification result
    // -------------------------------------------------------

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    next(error);
  }
};