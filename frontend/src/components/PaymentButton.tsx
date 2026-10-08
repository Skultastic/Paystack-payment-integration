import { useState } from "react";

import {
  startTrial,
  initializePayment,
} from "../services/paymentApi";

interface PaymentButtonProps {
  userId: number;
  email: string;
  planId: number;
  mode: "trial" | "payment";
  children: string;
}

function PaymentButton({
  userId,
  email,
  planId,
  mode,
  children,
}: PaymentButtonProps) {
  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const handlePayment = async () => {
    if (loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result =
        mode === "trial"
          ? await startTrial(
              userId,
              planId
            )
          : await initializePayment(
              userId,
              email,
              planId
            );

      const redirectUrl =
        mode === "trial"
          ? result.trial.authorizationUrl
          : result.payment.authorizationUrl;

      if (!redirectUrl) {
        throw new Error(
          "Payment redirect URL was not returned."
        );
      }

      window.location.assign(
        redirectUrl
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong."
      );

      setLoading(false);
    }
  };

  return (
    <div className="payment-button-wrapper">
      <button
        type="button"
        onClick={handlePayment}
        disabled={loading}
        className="payment-button"
      >
        {loading
          ? "Redirecting..."
          : children}
      </button>

      {error && (
        <p
          className="payment-error"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export default PaymentButton;