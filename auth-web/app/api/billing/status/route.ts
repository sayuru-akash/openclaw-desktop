import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getBillingStatus } from "../../../lib/billing/entitlement-service";

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const status = await getBillingStatus(userId);
  return NextResponse.json(status);
}
