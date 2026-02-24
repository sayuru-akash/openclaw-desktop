import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { entitlements, users } from "../../../../db/schema";
import { db } from "../../../lib/billing/db";
import { createCustomerPortalSession } from "../../../lib/billing/polar";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Look up the user's Polar customer ID
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!user) {
    return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  }

  const [entitlement] = await db
    .select()
    .from(entitlements)
    .where(eq(entitlements.userId, user.id))
    .limit(1);

  if (!entitlement?.providerCustomerId) {
    return NextResponse.json(
      { ok: false, error: "No active subscription found. Complete checkout first." },
      { status: 400 },
    );
  }

  const session = await createCustomerPortalSession({
    customerId: entitlement.providerCustomerId,
  });

  return NextResponse.json({ ok: true, portalUrl: session.customer_portal_url });
}
