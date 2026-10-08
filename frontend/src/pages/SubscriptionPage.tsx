import { useEffect, useState } from "react";

import SubscriptionCard from "../components/SubscriptionCard";

import {
  getUserSubscription,
  cancelSubscription,
  enableSubscription,
} from "../services/paymentApi";

import type { Subscription } from "../types/payment";

interface SubscriptionPageProps {
  userId: number;
}

function SubscriptionPage({
  userId,
}: SubscriptionPageProps) {
  const [
    subscription,
    setSubscription,
  ] = useState<Subscription | null>(
    null
  );

  const [loading, setLoading] =
    useState(true);

  const [actionLoading, setActionLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const loadSubscription =
    async () => {
      try {
        setLoading(true);
        setError(null);

        const result =
          await getUserSubscription(
            userId
          );

        setSubscription(result);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Unable to load subscription."
        );
      } finally {
        setLoading(false);
      }
    };

  useEffect(() => {
    loadSubscription();
  }, [userId]);

  const handleCancel = async () => {
    if (!subscription) {
      return;
    }

    const confirmed =
      window.confirm(
        "Are you sure you want to cancel your subscription?"
      );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(true);
      setError(null);

      await cancelSubscription(
        subscription.id,
        userId
      );

      await loadSubscription();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to cancel subscription."
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleEnable = async () => {
    if (!subscription) {
      return;
    }

    try {
      setActionLoading(true);
      setError(null);

      await enableSubscription(
        subscription.id,
        userId
      );

      await loadSubscription();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to enable subscription."
      );
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="subscription-page">
        <div className="subscription-loading">
          <div className="payment-spinner" />

          <h1>
            Loading subscription
          </h1>

          <p>
            Please wait...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="subscription-page">
      <header className="subscription-header">
        <span className="subscription-label">
          ACCOUNT
        </span>

        <h1>
          Your Subscription
        </h1>

        <p>
          Manage your current plan and
          billing settings.
        </p>
      </header>

      {error && (
        <div
          className="subscription-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {!subscription && (
        <section className="subscription-empty">
          <h2>
            No active subscription
          </h2>

          <p>
            You don't currently have a
            subscription.
          </p>
        </section>
      )}

      {subscription && (
        <SubscriptionCard
          subscription={subscription}
          onCancel={handleCancel}
          onEnable={handleEnable}
          loading={actionLoading}
        />
      )}
    </main>
  );
}

export default SubscriptionPage;