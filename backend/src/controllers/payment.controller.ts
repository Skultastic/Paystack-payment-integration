import { Request, Response, NextFunction } from "express";
import {
  initializePayment, verifyPayment} from "../services/payment.service";

export const initializePaymentController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get the payment details sent by the frontend
    const { email, planId, userId } = req.body;

    // Make sure all required values were provided
    if (!email || !planId || !userId) {
      return res.status(400).json({
        message: "email, planId and userId are required",
      });
    }

    // Send the details to the payment service
    // The service handles PostgreSQL and Paystack
    const payment = await initializePayment(
      email,
      Number(planId), // Convert planId from string to number
      Number(userId)  // Convert userId from string to number
    );

    // Return the Paystack checkout information to the frontend
    res.status(200).json(payment);

  } catch (error) {
    // Pass unexpected errors to our error-handling middleware
    next(error);
  }
};

export const verifyPaymentController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get the Paystack transaction reference from the URL
    const reference = req.params.reference as string;

    // Make sure a reference was provided
    if (!reference) {
      return res.status(400).json({
        message: "Payment reference is required",
      });
    }

    // Send the reference to the payment service
    // The service communicates with Paystack and updates our database
    const payment = await verifyPayment(reference);

    // Return the verification result to the frontend
    res.status(200).json(payment);

  } catch (error) {
    // Pass unexpected errors to our error-handling middleware
    next(error);
  }
};