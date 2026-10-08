const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000/api";

// =========================================================
// START TRIAL
// =========================================================

export const startTrial = async (
  userId: number,
  planId: number
) => {
  const response = await fetch(
    `${API_URL}/trials/start`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        planId,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message ||
        "Unable to start trial"
    );
  }

  return data;
};

// =========================================================
// INITIALIZE PAYMENT
// =========================================================

export const initializePayment =
  async (
    userId: number,
    email: string,
    planId: number
  ) => {
    const response = await fetch(
      `${API_URL}/payments/initialize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          email,
          planId,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
          "Unable to initialize payment"
      );
    }

    // -------------------------------------------------------
    // Convert backend snake_case fields to the
    // camelCase format used by the frontend.
    // -------------------------------------------------------

    return {
      ...data,
      payment: data.payment
        ? {
            ...data.payment,

            authorizationUrl:
              data.payment
                .authorization_url,

            accessCode:
              data.payment
                .access_code,
          }
        : null,
    };
  };

// =========================================================
// VERIFY PAYMENT
// =========================================================

export const verifyPayment = async (
  reference: string
) => {
  const response = await fetch(
    `${API_URL}/payments/verify/${encodeURIComponent(
      reference
    )}`
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message ||
        "Unable to verify payment"
    );
  }

  return data;
};

// =========================================================
// GET USER SUBSCRIPTION
// =========================================================

export const getUserSubscription =
  async (userId: number) => {
    const response = await fetch(
      `${API_URL}/subscriptions/user/${userId}`
    );

    const data = await response.json();

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
          "Unable to load subscription"
      );
    }

    return data.subscription;
  };

// =========================================================
// CANCEL SUBSCRIPTION
// =========================================================

export const cancelSubscription =
  async (
    subscriptionId: number,
    userId: number
  ) => {
    const response = await fetch(
      `${API_URL}/subscriptions/${subscriptionId}/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
          "Unable to cancel subscription"
      );
    }

    return data;
  };

// =========================================================
// ENABLE SUBSCRIPTION
// =========================================================

export const enableSubscription =
  async (
    subscriptionId: number,
    userId: number
  ) => {
    const response = await fetch(
      `${API_URL}/subscriptions/${subscriptionId}/enable`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
          "Unable to enable subscription"
      );
    }

    return data;
  };