import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const payload = JSON.stringify({
  event: "charge.success",
  data: {
    id: 123456,
    status: "success",
    reference: "TEST-WEBHOOK-123",
    amount: 9900,
    currency: "ZAR",
  },
});

// Generate the same HMAC signature Paystack uses
const signature = crypto
  .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!)
  .update(payload)
  .digest("hex");

console.log("Webhook signature:");
console.log(signature);