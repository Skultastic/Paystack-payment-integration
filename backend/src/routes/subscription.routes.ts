import { Router } from "express";

import {
  getUserSubscriptionController,
  cancelSubscriptionController,
  enableSubscriptionController,
} from "../controllers/subscription.controller";

const router = Router();

// Get current subscription
router.get(
  "/user/:userId",
  getUserSubscriptionController
);

// Cancel / stop renewal
router.post(
  "/:id/cancel",
  cancelSubscriptionController
);

// Re-enable subscription
router.post(
  "/:id/enable",
  enableSubscriptionController
);

export default router;