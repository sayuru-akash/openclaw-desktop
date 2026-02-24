import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createCheckoutSession } from "../../../lib/billing/polar";

const PRODUCT_IDS: Record<string, string | undefined> = {
  monthly: process.env.POLAR_PRODUCT_ID_MONTHLY,
  yearly: process.env.POLAR_PRODUCT_ID_YEARLY,
};

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const plan = (body.plan as string) ?? "monthly";
  const productId = PRODUCT_IDS[plan];

  if (!productId) {
    return NextResponse.json(
      { ok: false, error: `Invalid plan: ${plan}. Use "monthly" or "yearly".` },
      { status: 400 },
    );
  }

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;

  if (!email) {
    return NextResponse.json({ ok: false, error: "No email on account" }, { status: 400 });
  }

  const checkout = await createCheckoutSession({
    productId,
    customerEmail: email,
    metadata: { clerk_user_id: userId },
  });

  return NextResponse.json({ ok: true, checkoutUrl: checkout.url });
}
