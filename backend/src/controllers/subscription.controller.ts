import {
  Request,
  Response,
  NextFunction,
} from "express";

import {
  getUserSubscription,
  cancelSubscription,
  enableSubscription,
} from "../services/subscription.service";

// =========================================================
// GET USER SUBSCRIPTION
// =========================================================

export const getUserSubscriptionController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId =
      Number(req.params.userId);

    if (!Number.isInteger(userId)) {
      return res.status(400).json({
        message:
          "Invalid user ID",
      });
    }

    const subscription =
      await getUserSubscription(
        userId
      );

    if (!subscription) {
      return res.status(404).json({
        message:
          "No subscription found",
      });
    }

    return res.status(200).json({
      success: true,
      subscription,
    });
  } catch (error) {
    next(error);
  }
};

// =========================================================
// CANCEL SUBSCRIPTION
// =========================================================

export const cancelSubscriptionController =
  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const subscriptionId =
        Number(req.params.id);

      const {
        userId,
      } = req.body;

      if (
        !Number.isInteger(
          subscriptionId
        )
      ) {
        return res.status(400).json({
          message:
            "Invalid subscription ID",
        });
      }

      if (!userId) {
        return res.status(400).json({
          message:
            "userId is required",
        });
      }

      const result =
        await cancelSubscription(
          subscriptionId,
          Number(userId)
        );

      return res.status(200).json(
        result
      );
    } catch (error) {
      next(error);
    }
  };

// =========================================================
// ENABLE SUBSCRIPTION
// =========================================================

export const enableSubscriptionController =
  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const subscriptionId =
        Number(req.params.id);

      const {
        userId,
      } = req.body;

      if (
        !Number.isInteger(
          subscriptionId
        )
      ) {
        return res.status(400).json({
          message:
            "Invalid subscription ID",
        });
      }

      if (!userId) {
        return res.status(400).json({
          message:
            "userId is required",
        });
      }

      const result =
        await enableSubscription(
          subscriptionId,
          Number(userId)
        );

      return res.status(200).json(
        result
      );
    } catch (error) {
      next(error);
    }
  };