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

    if (!userId || !planId) {
      return res.status(400).json({
        message:
          "userId and planId are required",
      });
    }

    const trial =
      await startTrial(
        Number(userId),
        Number(planId)
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

export const expireTrialsController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const expired =
      await expireTrials();

    return res.status(200).json({
      success: true,
      count: expired.length,
      subscriptions: expired,
    });
  } catch (error) {
    next(error);
  }
};