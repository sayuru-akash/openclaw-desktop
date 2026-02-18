const revealNodes = [...document.querySelectorAll(".reveal")];

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      entry.target.classList.add("in");
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.12 }
);

revealNodes.forEach((node, index) => {
  node.style.transitionDelay = `${Math.min(index * 30, 220)}ms`;
  observer.observe(node);
});

const yearNode = document.querySelector("#year");
if (yearNode) {
  yearNode.textContent = String(new Date().getFullYear());
}

const config = window.OPENCLAW_WEBSITE_CONFIG || {};
const paywallNode = document.querySelector("#paywall");
const paywallForm = document.querySelector("#paywall-form");
const paywallEmail = document.querySelector("#paywall-email");
const paywallError = document.querySelector("#paywall-error");
const paywallPortalLink = document.querySelector("#paywall-portal-link");
const openPaywallButtons = [...document.querySelectorAll("[data-open-paywall]")];
const closePaywallButtons = [...document.querySelectorAll("[data-close-paywall]")];
const priceLabel = typeof config.appPriceLabel === "string" ? config.appPriceLabel.trim() : "$5";

const checkoutUrl = typeof config.polarCheckoutUrl === "string" ? config.polarCheckoutUrl.trim() : "";
const portalUrl = typeof config.polarPortalUrl === "string" ? config.polarPortalUrl.trim() : "";

const openPaywall = () => {
  if (!paywallNode) {
    return;
  }

  paywallNode.hidden = false;
  document.body.classList.add("modal-open");

  if (paywallEmail) {
    paywallEmail.focus();
  }
};

const closePaywall = () => {
  if (!paywallNode) {
    return;
  }

  paywallNode.hidden = true;
  document.body.classList.remove("modal-open");
};

openPaywallButtons.forEach((button) => {
  button.addEventListener("click", openPaywall);
});

closePaywallButtons.forEach((button) => {
  button.addEventListener("click", closePaywall);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && paywallNode && !paywallNode.hidden) {
    closePaywall();
  }
});

if (paywallPortalLink) {
  if (portalUrl && !portalUrl.includes("your-org")) {
    paywallPortalLink.href = portalUrl;
  } else {
    paywallPortalLink.removeAttribute("href");
  }
}

if (paywallForm && paywallEmail && paywallError) {
  paywallForm.addEventListener("submit", (event) => {
    event.preventDefault();
    paywallError.textContent = "";

    const email = paywallEmail.value.trim();
    const emailValid = paywallEmail.checkValidity();
    if (!email || !emailValid) {
      paywallError.textContent = "Enter a valid email.";
      paywallEmail.focus();
      return;
    }

    if (!checkoutUrl || checkoutUrl.includes("your-org")) {
      paywallError.textContent = "Checkout link is not configured yet.";
      return;
    }

    let url;
    try {
      url = new URL(checkoutUrl);
    } catch {
      paywallError.textContent = "Checkout URL is invalid.";
      return;
    }

    url.searchParams.set("customer_email", email);
    url.searchParams.set("utm_source", "openclaw-desktop-website");
    url.searchParams.set("utm_medium", "paywall");
    url.searchParams.set("utm_campaign", "installer");
    url.searchParams.set("reference_id", `openclaw-desktop-${Date.now()}`);

    window.location.assign(url.toString());
  });
}

const paywallTitle = document.querySelector("#paywall-title");
if (paywallTitle) {
  paywallTitle.textContent = `Pay ${priceLabel} and Download`;
}
