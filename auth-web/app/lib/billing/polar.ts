const POLAR_API = "https://api.polar.sh/v1";

function headers() {
  return {
    Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

/**
 * Create a Polar checkout session for a given product.
 */
export async function createCheckoutSession(opts: {
  productId: string;
  customerEmail: string;
  successUrl?: string;
  metadata?: Record<string, string>;
}) {
  const res = await fetch(`${POLAR_API}/checkouts/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      products: [opts.productId],
      customer_email: opts.customerEmail,
      success_url: opts.successUrl ?? process.env.POLAR_SUCCESS_URL,
      metadata: opts.metadata,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polar checkout error ${res.status}: ${body}`);
  }

  return res.json() as Promise<{ id: string; url: string; [key: string]: unknown }>;
}

/**
 * Create a Polar customer portal session.
 * Returns the portal URL where the customer can manage their subscription.
 */
export async function createCustomerPortalSession(opts: {
  customerId: string;
  returnUrl?: string;
}) {
  const res = await fetch(`${POLAR_API}/customer-sessions/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      customer_id: opts.customerId,
      return_url: opts.returnUrl,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polar portal error ${res.status}: ${body}`);
  }

  return res.json() as Promise<{ id: string; customer_portal_url: string; [key: string]: unknown }>;
}
