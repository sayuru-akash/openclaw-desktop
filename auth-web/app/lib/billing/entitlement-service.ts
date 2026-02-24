import { eq } from "drizzle-orm";
import { db } from "./db";
import { entitlements, users } from "../../../db/schema";
import {
  type BillingState,
  type BillingStatus,
  ENTITLED_STATES,
  TRIAL_DAYS,
} from "./types";

/**
 * Get or create a user + entitlement record for a Clerk user.
 * On first call, starts a 7-day trial automatically.
 */
export async function getOrCreateEntitlement(clerkUserId: string, email?: string) {
  // Find existing user
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (!user) {
    // Create user
    [user] = await db
      .insert(users)
      .values({ clerkUserId, email: email ?? null })
      .returning();
  }

  // Find existing entitlement
  let [entitlement] = await db
    .select()
    .from(entitlements)
    .where(eq(entitlements.userId, user.id))
    .limit(1);

  if (!entitlement) {
    // Start trial
    const now = new Date();
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    [entitlement] = await db
      .insert(entitlements)
      .values({
        userId: user.id,
        state: "trial_active",
        trialStartAt: now,
        trialEndAt: trialEnd,
      })
      .returning();
  }

  return { user, entitlement };
}

/**
 * Compute the current billing state, handling trial expiry automatically.
 */
export function computeState(entitlement: {
  state: string;
  trialEndAt: Date | null;
  graceEndAt: Date | null;
}): BillingState {
  const now = new Date();

  // Auto-expire trial
  if (entitlement.state === "trial_active" && entitlement.trialEndAt && now > entitlement.trialEndAt) {
    return "trial_ended";
  }

  // Auto-expire grace period
  if (entitlement.state === "grace_period" && entitlement.graceEndAt && now > entitlement.graceEndAt) {
    return "past_due";
  }

  return entitlement.state as BillingState;
}

/**
 * Build the full BillingStatus response for a user.
 */
export async function getBillingStatus(clerkUserId: string, email?: string): Promise<BillingStatus> {
  const { entitlement } = await getOrCreateEntitlement(clerkUserId, email);
  const state = computeState(entitlement);

  // If state drifted (e.g. trial expired), persist the update
  if (state !== entitlement.state) {
    await db
      .update(entitlements)
      .set({ state, updatedAt: new Date() })
      .where(eq(entitlements.id, entitlement.id));
  }

  const entitled = ENTITLED_STATES.has(state);
  const trialDaysLeft =
    state === "trial_active" && entitlement.trialEndAt
      ? Math.max(0, Math.ceil((entitlement.trialEndAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : null;

  return {
    ok: true,
    state,
    entitled,
    trialDaysLeft,
    trialEndAt: entitlement.trialEndAt?.toISOString() ?? null,
    graceEndAt: entitlement.graceEndAt?.toISOString() ?? null,
    currentPeriodEndAt: entitlement.currentPeriodEndAt?.toISOString() ?? null,
    manageUrl: null, // populated when Polar is configured
    checkoutRequired: !entitled,
  };
}
