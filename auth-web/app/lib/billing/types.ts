export type EntitledState = "trial_active" | "active_subscription" | "grace_period";
export type BlockedState = "trial_ended" | "past_due" | "canceled" | "blocked";
export type BillingState = EntitledState | BlockedState;

export const ENTITLED_STATES: ReadonlySet<BillingState> = new Set<EntitledState>([
  "trial_active",
  "active_subscription",
  "grace_period",
]);

export interface BillingStatus {
  ok: true;
  state: BillingState;
  entitled: boolean;
  trialDaysLeft: number | null;
  trialEndAt: string | null;
  graceEndAt: string | null;
  currentPeriodEndAt: string | null;
  manageUrl: string | null;
  checkoutRequired: boolean;
}

export const TRIAL_DAYS = Number(process.env.BILLING_TRIAL_DAYS ?? 7);
export const GRACE_DAYS = Number(process.env.BILLING_GRACE_DAYS ?? 3);
