import { Router } from "express";
import { initializePaymentController, verifyPaymentController,} from "../controllers/payment.controller";
const router = Router();

// POST /api/payments/initialize
// Starts a new Paystack payment transaction
router.post("/initialize", initializePaymentController);

// GET /api/payments/verify/:reference
// Verifies a completed Paystack transaction
router.get("/verify/:reference", verifyPaymentController);



export default router;