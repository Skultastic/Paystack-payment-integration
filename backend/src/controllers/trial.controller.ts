import {
  Request,
  Response,
  NextFunction,
} from "express";

import {
  startTrial,
  expireTrials,
} from "../services/trial.service";

// =========================================================
// START TRIAL
// =========================================================

export const startTrialController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      userId,
      planId,
    } = req.body;

    // -------------------------------------------------------
    // Convert IDs
    // -------------------------------------------------------

    const parsedUserId =
      Number(userId);

    const parsedPlanId =
      Number(planId);

    // -------------------------------------------------------
    // Validate user ID
    // -------------------------------------------------------

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
    // Validate plan ID
    // -------------------------------------------------------

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
    // Start trial
    // -------------------------------------------------------

    const trial =
      await startTrial(
        parsedUserId,
        parsedPlanId
      );

    return res.status(201).json({
      success: true,
      trial,
    });
  } catch (error) {
    next(error);
  }
};

// =========================================================
// PROCESS EXPIRED TRIALS
// =========================================================

export const expireTrialsController =
  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const expired =
        await expireTrials();

      return res.status(200).json({
        success: true,
        count:
          expired.length,
        subscriptions:
          expired,
      });
    } catch (error) {
      next(error);
    }
  };