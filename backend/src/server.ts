import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import pool from "./config/database";

import paymentRoutes from "./routes/payment.routes";
import webhookRoutes from "./routes/webhook.routes";
import trialRoutes from "./routes/trial.routes";
import subscriptionRoutes from "./routes/subscription.routes";

// =========================================================
// ENVIRONMENT
// =========================================================

dotenv.config();

// =========================================================
// APP
// =========================================================

const app = express();

// =========================================================
// CORS
// =========================================================

app.use(
  cors({
    origin:
      process.env.FRONTEND_URL ||
      "http://localhost:5173",

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

// =========================================================
// JSON BODY PARSER
// =========================================================
//
// We keep the raw body because Paystack signs the exact
// request body when sending webhooks.
//
// The webhook controller uses this raw body to verify:
// x-paystack-signature
// =========================================================

app.use(
  express.json({
    verify: (
      req,
      res,
      buf
    ) => {
      (req as any).rawBody = buf;
    },
  })
);

// =========================================================
// HEALTH CHECK
// =========================================================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message:
      "Paystack Learning Platform API is running",
  });
});

// =========================================================
// DATABASE HEALTH CHECK
// =========================================================

app.get("/api/test-db",async (req, res) => {
    try {
      const result =  await pool.query(
          "SELECT NOW()"
        );

      return res.status(200).json({
        success: true,
        message:
          "Database connection successful",
        time:
          result.rows[0].now,
      });
    } catch (error) {
      console.error(
        "Database health check failed:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Database connection failed",
      });
    }
  }
);



app.use( "/api/payments", paymentRoutes);app.use("/api/webhooks",webhookRoutes);
app.use( "/api/trials", trialRoutes);
app.use(  "/api/subscriptions",subscriptionRoutes);



app.use((req, res) => {
    return res.status(404).json({
      success: false,
      message:
        "API route not found",
    });
  }
);

// =========================================================
// GLOBAL ERROR HANDLER
// =========================================================

app.use(
  (
    error: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error(
      "Unhandled server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      success: false,
      message:
        "Internal server error",
    });
  }
);

// =========================================================
// START SERVER
// =========================================================

const PORT =
  Number(process.env.PORT) || 5000;

app.listen(
  PORT,
  () => {
    console.log(
      `Server running on http://localhost:${PORT}`
    );
  }
);