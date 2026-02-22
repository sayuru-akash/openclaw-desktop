import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function Paywall({ open, onClose, config }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const priceLabel = config?.appPriceLabel?.trim() || "$5";
  const checkoutUrl = config?.polarCheckoutUrl?.trim() || "";
  const portalUrl = config?.polarPortalUrl?.trim() || "";

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && open) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    document.body.classList.toggle("modal-open", open);
    return () => document.body.classList.remove("modal-open");
  }, [open]);

  function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const trimmed = email.trim();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    if (!trimmed || !valid) {
      setError("Enter a valid email.");
      inputRef.current?.focus();
      return;
    }

    if (!checkoutUrl || checkoutUrl.includes("your-org")) {
      setError("Checkout link is not configured yet.");
      return;
    }

    let url;
    try {
      url = new URL(checkoutUrl);
    } catch {
      setError("Checkout URL is invalid.");
      return;
    }

    url.searchParams.set("customer_email", trimmed);
    url.searchParams.set("utm_source", "openclaw-desktop-website");
    url.searchParams.set("utm_medium", "paywall");
    url.searchParams.set("utm_campaign", "installer");
    url.searchParams.set("reference_id", `openclaw-desktop-${Date.now()}`);
    window.location.assign(url.toString());
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="paywall"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="paywall-backdrop" onClick={onClose} aria-hidden="true" />
          <motion.section
            className="paywall-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paywall-title"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <button className="paywall-close" type="button" onClick={onClose} aria-label="Close">
              ×
            </button>
            <p className="eyebrow">Checkout</p>
            <h3 id="paywall-title">Pay {priceLabel} and Download</h3>
            <p className="paywall-copy">Enter your email. We open Polar checkout next.</p>
            <form id="paywall-form" onSubmit={handleSubmit} noValidate>
              <label htmlFor="paywall-email">Email</label>
              <input
                id="paywall-email"
                ref={inputRef}
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="form-error" role="status" aria-live="polite">
                {error}
              </p>
              <button className="button primary paywall-submit" type="submit">
                Continue to checkout
              </button>
            </form>
            <p className="paywall-note">
              After payment, access your installer from{" "}
              {portalUrl && !portalUrl.includes("your-org") ? (
                <a href={portalUrl} target="_blank" rel="noreferrer">
                  Polar customer portal
                </a>
              ) : (
                <span>Polar customer portal</span>
              )}
              .
            </p>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
