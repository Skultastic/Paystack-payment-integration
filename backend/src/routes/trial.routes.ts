import { Router } from "express";

import {
  startTrialController,
  expireTrialsController,
} from "../controllers/trial.controller";

const router = Router();

router.post(
  "/start",
  startTrialController
);

router.post(
  "/expire",
  expireTrialsController
);

export default router;