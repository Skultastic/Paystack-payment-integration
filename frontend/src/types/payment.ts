export type PlanName =
  | "Standard"
  | "Premium"
  | "Video Add-on";

export type SubscriptionStatus =
  | "pending"
  | "trialing"
  | "active"
  | "non-renewing"
  | "cancelled"
  | "completed";

export interface PaymentInitialization {
  success: boolean;
  payment: {
    reference: string;
    authorizationUrl: string;
    accessCode: string;
    amountZar: number;
    currency: string;
    paymentType: string;
  };
}

export interface TrialInitialization {
  success: boolean;
  trial: {
    subscriptionId: number;
    planId: number;
    planName: string;
    priceZar: number;
    trialDays: number;
    trialStart: string;
    trialEnd: string;
    reference: string;
    authorizationUrl: string;
    accessCode: string;
  };
}

export interface Subscription {
  id: number;
  user_id: number;
  plan_id: number;
  plan_name: PlanName;
  price_zar: number;
  billing_interval: string;
  status: SubscriptionStatus;

  trial_start_date: string | null;
  trial_end_date: string | null;

  start_date: string | null;
  next_payment_date: string | null;
  cancelled_at: string | null;

  trialExpired?: boolean;
}