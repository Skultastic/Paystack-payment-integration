import express from "express";
import cors from "cors";
import pool from "./config/database";
import dotenv from "dotenv";
import paymentRoutes from "./routes/payment.routes";
import webhookRoutes from "./routes/webhook.routes";



dotenv.config();

const app = express();

app.use(cors());
app.use(
  express.json({
    // Keep the original request body for Paystack signature verification
    verify: (req, res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
// Register all payment-related API routes
app.use("/api/payments", paymentRoutes);
app.use("/api/webhooks", webhookRoutes);


app.get("/", (req, res) => {
  res.json({
    message: "Paystack Learning Platform API is running",
  });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      message: "Database connection successful",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Database connection failed",
    });
  }
});


const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});