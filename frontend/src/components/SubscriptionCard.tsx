import type { Subscription } from "../types/payment";

interface SubscriptionCardProps {
  subscription: Subscription;
  onCancel: () => void;
  onEnable: () => void;
  loading: boolean;
}

function SubscriptionCard({
  subscription,
  onCancel,
  onEnable,
  loading,
}: SubscriptionCardProps) {
  const isTrialing =
    subscription.status === "trialing";

  const isActive =
    subscription.status === "active";

  const isNonRenewing =
    subscription.status ===
    "non-renewing";

  const trialExpired =
    subscription.trialExpired === true;

  const canCancel =
    isTrialing ||
    isActive;

  const canEnable =
    isNonRenewing;

  const dateOptions: Intl.DateTimeFormatOptions =
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    };

  const formatDate = (
    value: string | null
  ) => {
    if (!value) {
      return "Not available";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Not available";
    }

    return date.toLocaleDateString(
      "en-ZA",
      dateOptions
    );
  };

  const getStatusLabel = () => {
    switch (subscription.status) {
      case "trialing":
        return trialExpired
          ? "Trial Ended"
          : "Free Trial";

      case "active":
        return "Active";

      case "non-renewing":
        return "Cancelling";

      case "cancelled":
        return "Cancelled";

      case "completed":
        return "Completed";

      case "pending":
        return "Pending";

      default:
        return subscription.status;
    }
  };

  return (
    <section className="subscription-card">
      <div className="subscription-card-header">
        <div>
          <span className="subscription-label">
            CURRENT PLAN
          </span>

          <h2>
            {subscription.plan_name}
          </h2>
        </div>

        <span
          className={`subscription-status subscription-status-${subscription.status}`}
        >
          {getStatusLabel()}
        </span>
      </div>

      <div className="subscription-price">
        <span>
          R{subscription.price_zar}
        </span>

        <small>
          /month
        </small>
      </div>

      {isTrialing && (
        <div className="subscription-info">
          <strong>
            {trialExpired
              ? "Trial ended"
              : "Trial ends"}
          </strong>

          <span>
            {formatDate(
              subscription.trial_end_date
            )}
          </span>
        </div>
      )}

      {(isActive ||
        isNonRenewing) && (
        <div className="subscription-info">
          <strong>
            Next payment
          </strong>

          <span>
            {formatDate(
              subscription.next_payment_date
            )}
          </span>
        </div>
      )}

      {trialExpired && (
        <p className="subscription-notice">
          Your 3-day free trial has
          ended.
        </p>
      )}

      {isNonRenewing && (
        <p className="subscription-notice">
          Your subscription will not
          renew after the current
          billing period.
        </p>
      )}

      {subscription.status ===
        "cancelled" && (
        <p className="subscription-notice">
          Your subscription has been
          cancelled.
        </p>
      )}

      {canCancel && (
        <button
          type="button"
          className="subscription-action subscription-action-danger"
          onClick={onCancel}
          disabled={loading}
        >
          {loading
            ? "Processing..."
            : "Cancel Subscription"}
        </button>
      )}

      {canEnable && (
        <button
          type="button"
          className="subscription-action"
          onClick={onEnable}
          disabled={loading}
        >
          {loading
            ? "Processing..."
            : "Keep Subscription Active"}
        </button>
      )}
    </section>
  );
}

export default SubscriptionCard;