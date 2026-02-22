import { useState } from "react";
import { motion } from "framer-motion";
import { AnimatedTitle } from "./components/AnimatedTitle";
import { Reveal } from "./components/Reveal";
import { Paywall } from "./components/Paywall";

const config = window.OPENCLAW_WEBSITE_CONFIG || {};
const priceLabel = config?.appPriceLabel?.trim() || "$5";

export default function App() {
  const [paywallOpen, setPaywallOpen] = useState(false);
  const year = new Date().getFullYear();

  return (
    <>
      <div className="page-bg" aria-hidden="true" />

      {/* Nav */}
      <header className="shell">
        <nav className="top-nav">
          <a href="#" className="brand">
            <img src="/openclaw_logo.png" alt="" aria-hidden="true" className="brand-logo" />
          </a>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how">How It Works</a>
            <a href="#download">Download</a>
          </div>
          <button className="button ghost" type="button" onClick={() => setPaywallOpen(true)}>
            Get App
          </button>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="hero shell">
          <Reveal>
            <p className="hero-tag">Windows-first OpenClaw</p>
          </Reveal>

          <AnimatedTitle as="h1">
            Run OpenClaw on Windows in minutes.
          </AnimatedTitle>

          <Reveal delay={0.1}>
            <p className="hero-copy">
              Install once, follow a guided flow, and start using OpenClaw without npm commands, manual
              config files, or separate browser setup.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="hero-cta">
              <button className="button primary" type="button" onClick={() => setPaywallOpen(true)}>
                Pay {priceLabel} and Download
              </button>
              <a className="button soft" href="#how">
                See Setup Flow
              </a>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <p className="micro-note">Supports Windows 10 (19041+) and Windows 11 on physical hardware.</p>
          </Reveal>

          <motion.div
            className="product-preview"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } } }}
          >
            <motion.div
              className="preview-top"
              variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } } }}
            >
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
              <p>OpenClaw Desktop</p>
            </motion.div>

            <div className="preview-grid">
              {[
                { step: "1. Install", body: "WSL + OpenClaw setup is automated." },
                { step: "2. Onboard", body: "Provider, model, WhatsApp, Telegram." },
                { step: "3. Run", body: "Gateway controls in-app and from tray." },
              ].map((item) => (
                <motion.article
                  key={item.step}
                  variants={{
                    hidden: { opacity: 0, y: 28, scale: 0.97 },
                    show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
                  }}
                >
                  <h3>{item.step}</h3>
                  <p>{item.body}</p>
                </motion.article>
              ))}
            </div>
          </motion.div>
        </section>

        {/* Features */}
        <section id="features" className="shell section">
          <div className="section-head">
            <Reveal>
              <p className="eyebrow">Features</p>
            </Reveal>
            <AnimatedTitle>Everything needed for day-one users.</AnimatedTitle>
          </div>
          <div className="card-grid">
            {[
              { title: "Guided Windows Setup", body: "Installs WSL, handles reboot-resume, and starts OpenClaw automatically." },
              { title: "In-App Onboarding", body: "Complete provider, model, and channel setup from a clean step-by-step UI." },
              { title: "Channel Controls", body: "View WhatsApp/Telegram status, reconnect channels, or disable them in one place." },
              { title: "Model Management", body: "Change provider/model anytime without rerunning full onboarding." },
              { title: "Background Runtime", body: "Tray actions for Start, Stop, and Status. Optional always-on at Windows sign-in." },
              { title: "Update Ready", body: "Built for in-app update checks with minimal install-and-restart flow." },
            ].map((card, i) => (
              <Reveal key={card.title} delay={i * 0.05}>
                <article className="feature-card">
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Compare */}
        <section className="shell section compare-wrap">
          <div className="section-head">
            <Reveal>
              <p className="eyebrow">Why This</p>
            </Reveal>
            <AnimatedTitle>From setup stress to one clean flow.</AnimatedTitle>
          </div>
          <Reveal delay={0.05}>
            <div className="compare-stage">
              <article className="compare-panel before">
                <p className="panel-badge">Manual path</p>
                <h3>What users struggle with</h3>
                <div className="panel-list">
                  <p>Install Node/npm and WSL by hand</p>
                  <p>Run terminal commands in the right order</p>
                  <p>Edit `openclaw.json` safely</p>
                  <p>Keep gateway alive manually</p>
                </div>
                <small>Usually 45 to 90 minutes for first-time users</small>
              </article>
              <article className="compare-panel after">
                <p className="panel-badge">OpenClaw Desktop</p>
                <h3>What they get instead</h3>
                <div className="panel-list">
                  <p>Install one `.exe` and start</p>
                  <p>Guided onboarding in a native UI</p>
                  <p>Visual model and channel management</p>
                  <p>Tray-based always-on controls</p>
                </div>
                <small>Typical first run to live gateway in about 10 minutes</small>
              </article>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="compare-metrics">
              {[
                { value: "~10 min", label: "Install to ready" },
                { value: "0 terminal", label: "For day-one setup" },
                { value: "2 channels", label: "WhatsApp + Telegram guided" },
              ].map((m) => (
                <article key={m.label}>
                  <strong>{m.value}</strong>
                  <p>{m.label}</p>
                </article>
              ))}
            </div>
          </Reveal>
        </section>

        {/* How It Works */}
        <section id="how" className="shell section">
          <div className="section-head">
            <Reveal>
              <p className="eyebrow">How It Works</p>
            </Reveal>
            <AnimatedTitle>Fast path from install to running.</AnimatedTitle>
          </div>
          <div className="steps">
            {[
              { num: "01", title: "Install App", body: "Launch the installer and open the desktop app." },
              { num: "02", title: "Finish Onboarding", body: "Pick provider/model, connect channels, save credentials." },
              { num: "03", title: "Go Live", body: "Use in-app Control workspace and tray runtime controls." },
            ].map((step, i) => (
              <Reveal key={step.num} delay={i * 0.08}>
                <article className="step">
                  <span>{step.num}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Download CTA */}
        <Reveal>
          <section id="download" className="shell section final-cta">
            <p className="eyebrow">Download</p>
            <AnimatedTitle>Get OpenClaw Desktop for Windows.</AnimatedTitle>
            <p>Single installer. Guided setup. Secure checkout with Polar.</p>
            <p className="download-compat-note">
              Requires WSL2 and hardware virtualization. Most Mac-hosted Windows VMs (UTM/Parallels) are
              not supported. Cloud VMs only work if nested virtualization is available.
            </p>
            <div className="hero-cta">
              <button className="button primary" type="button" onClick={() => setPaywallOpen(true)}>
                Pay {priceLabel} and Download
              </button>
            </div>
            <small>Checkout runs on Polar. Download is unlocked after payment.</small>
          </section>
        </Reveal>
      </main>

      <footer className="shell footer">
        <p>© {year} OpenClaw Desktop</p>
      </footer>

      <Paywall open={paywallOpen} onClose={() => setPaywallOpen(false)} config={config} />
    </>
  );
}
