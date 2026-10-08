import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { verifyPayment } from "../services/paymentApi";

function TrialCallbackPage() {
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<
    "loading" | "success" | "failed"
  >("loading");

  const [message, setMessage] = useState(
    "Verifying your card..."
  );

  useEffect(() => {
    const reference =
      searchParams.get("reference");

    if (!reference) {
      setStatus("failed");

      setMessage(
        "No verification reference was returned."
      );

      return;
    }

    const verify = async () => {
      try {
        const result =
          await verifyPayment(reference);

        if (
          result.payment?.status ===
          "success"
        ) {
          setStatus("success");

          setMessage(
            "Your card has been verified and your 3-day trial is active."
          );

          return;
        }

        setStatus("failed");

        setMessage(
          "We could not complete your trial setup."
        );
      } catch (error) {
        setStatus("failed");

        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to verify your card."
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

            <h1>
              Verifying your card
            </h1>
          </>
        )}

        {status === "success" && (
          <>
            <div className="payment-result-icon">
              ✓
            </div>

            <h1>
              Trial started
            </h1>
          </>
        )}

        {status === "failed" && (
          <>
            <div className="payment-result-icon">
              ×
            </div>

            <h1>
              Trial setup failed
            </h1>
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

export default TrialCallbackPage;