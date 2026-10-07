import { Router } from "express";
import { paystackWebhookController } from "../controllers/webhook.controller";

const router = Router();

// Paystack sends payment and subscription events here
router.post("/paystack", paystackWebhookController);

export default router;