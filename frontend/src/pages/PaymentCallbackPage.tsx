import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { verifyPayment } from "../services/paymentApi";

function PaymentCallbackPage() {
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<
    "loading" | "success" | "failed"
  >("loading");

  const [message, setMessage] =
    useState("Verifying your payment...");

  useEffect(() => {
    const reference =
      searchParams.get("reference");

    if (!reference) {
      setStatus("failed");
      setMessage(
        "No payment reference was returned."
      );
      return;
    }

    const verify = async () => {
      try {
        const result =
          await verifyPayment(reference);

        if (result.payment?.status === "success") {
          setStatus("success");
          setMessage(
            "Payment successful. Your subscription is being activated."
          );
        } else {
          setStatus("failed");
          setMessage(
            "Payment could not be completed."
          );
        }
      } catch (error) {
        setStatus("failed");

        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to verify payment."
        );
      }
    };

    verify();
  }, [searchParams]);

  return (
    <main className="payment-result-page">
      <div
        className={`payment-result-card ${status}`}
      >
        {status === "loading" && (
          <>
            <div className="payment-spinner" />
            <h1>Verifying payment</h1>
          </>
        )}

        {status === "success" && (
          <>
            <div className="payment-result-icon">
              ✓
            </div>

            <h1>Payment successful</h1>
          </>
        )}

        {status === "failed" && (
          <>
            <div className="payment-result-icon">
              ×
            </div>

            <h1>Payment unsuccessful</h1>
          </>
        )}

        <p>{message}</p>

        {status !== "loading" && (
          <button
            type="button"
            className="payment-button"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            Return to plans
          </button>
        )}
      </div>
    </main>
  );
}

export default PaymentCallbackPage;