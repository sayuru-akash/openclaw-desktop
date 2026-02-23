import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  PackageOpen,
  ListChecks,
  Zap,
  LayoutDashboard,
  BrainCircuit,
  Activity,
  RefreshCw,
  Download,
  ClipboardCheck,
  Rocket,
  Monitor,
  X,
  Check,
} from "lucide-react";
import { SiWhatsapp, SiTelegram } from "react-icons/si";
import { AnimatedTitle } from "./components/AnimatedTitle";
import { Reveal } from "./components/Reveal";
import { TiltCard } from "./components/TiltCard";
import brandMark from "../../assets/branding/openclaw.svg";

const DOWNLOAD_URL = "https://github.com/hith3sh/openclaw-desktop/releases/latest";

const features = [
  { icon: <Monitor size={22} />, title: "Guided Windows Setup", body: "One-click installer sets up Node.js and OpenClaw. No terminal, no reboots, no virtualization." },
  { icon: <LayoutDashboard size={22} />, title: "In-App Onboarding", body: "Complete provider, model, and channel setup from a clean step-by-step UI." },
  {
    icon: (
      <span className="icon-pair">
        <SiWhatsapp size={20} className="icon-whatsapp" />
        <SiTelegram size={20} className="icon-telegram" />
      </span>
    ),
    title: "Channel Controls",
    body: "View WhatsApp/Telegram status, reconnect channels, or disable them in one place.",
  },
  { icon: <BrainCircuit size={22} />, title: "Model Management", body: "Change provider/model anytime without rerunning full onboarding." },
  { icon: <Activity size={22} />, title: "Background Runtime", body: "Tray actions for Start, Stop, and Status. Optional always-on at Windows sign-in." },
  { icon: <RefreshCw size={22} />, title: "Update Ready", body: "Built for in-app update checks with minimal install-and-restart flow." },
];

const manualItems = [
  "Install and configure Node.js manually",
  "Run terminal commands in the right order",
  "Edit openclaw.json safely",
  "Keep gateway alive manually",
];

const desktopItems = [
  "Install one .exe and start",
  "Guided onboarding in a native UI",
  "Visual model and channel management",
  "Tray-based always-on controls",
];

const steps = [
  { num: "01", icon: <Download size={18} />, title: "Install App", body: "Launch the installer and open the desktop app." },
  { num: "02", icon: <ClipboardCheck size={18} />, title: "Finish Onboarding", body: "Pick provider/model, connect channels, save credentials." },
  { num: "03", icon: <Rocket size={18} />, title: "Go Live", body: "Use in-app Control workspace and tray runtime controls." },
];

export default function App() {
  const [navVisible, setNavVisible] = useState(true);
  const [navScrolled, setNavScrolled] = useState(false);
  const lastScrollY = useRef(0);
  const year = new Date().getFullYear();

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setNavScrolled(y > 20);
      if (y < 80) {
        setNavVisible(true);
      } else if (y > lastScrollY.current + 8) {
        setNavVisible(false);
      } else if (y < lastScrollY.current - 8) {
        setNavVisible(true);
      }
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* Fixed nav */}
      <div className={`nav-wrapper${navScrolled ? " nav-scrolled" : ""}${!navVisible ? " nav-hidden" : ""}`}>
        <header className="shell">
          <nav className="top-nav">
            <a href="#" className="brand">
              <img src={brandMark} alt="" aria-hidden="true" className="brand-logo" />
              <span>OpenClaw Desktop</span>
            </a>
            <div className="nav-links">
              <a href="#features">Features</a>
              <a href="#how">How It Works</a>
              <a href="#download">Download</a>
            </div>
            <a className="button ghost" href={DOWNLOAD_URL}>
              Download
            </a>
          </nav>
        </header>
      </div>

      <div className="hero-scene">
        <div className="page-bg" aria-hidden="true" />

        {/* Hero */}
        <section className="hero shell">
          <Reveal>
            <p className="hero-tag">Windows-first OpenClaw</p>
          </Reveal>

          <AnimatedTitle as="h1">Run OpenClaw on Windows in minutes.</AnimatedTitle>

          <Reveal delay={0.1}>
            <p className="hero-copy">
              Install once, follow a guided flow, and start using OpenClaw without npm commands, manual
              config files, or separate browser setup.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="hero-cta">
              <a className="button primary" href={DOWNLOAD_URL}>
                Download for Free
              </a>
              <a className="button soft" href="#how">
                See Setup Flow
              </a>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <p className="micro-note">Works on Windows 10 (19041+), Windows 11, and virtual machines.</p>
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
                { step: "1. Install", body: "Node.js and OpenClaw installed automatically.", icon: <PackageOpen size={20} /> },
                { step: "2. Onboard", body: "Provider, model, WhatsApp, Telegram.", icon: <ListChecks size={20} /> },
                { step: "3. Run", body: "Gateway controls in-app and from tray.", icon: <Zap size={20} /> },
              ].map((item) => (
                <motion.article
                  key={item.step}
                  variants={{
                    hidden: { opacity: 0, y: 28, scale: 0.97 },
                    show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
                  }}
                >
                  <span className="preview-card-icon">{item.icon}</span>
                  <h3>{item.step}</h3>
                  <p>{item.body}</p>
                </motion.article>
              ))}
            </div>
          </motion.div>
        </section>
      </div>{/* end hero-scene */}

      <main>
        {/* Features */}
        <section id="features" className="shell section">
          <div className="section-head">
            <Reveal>
              <p className="eyebrow">Features</p>
            </Reveal>
            <AnimatedTitle>Everything needed for day-one users.</AnimatedTitle>
          </div>
          <div className="card-grid">
            {features.map((card, i) => (
              <Reveal key={card.title} delay={i * 0.05}>
                <TiltCard animatedBorder>
                  <article className="feature-card">
                    <span className="feature-icon">{card.icon}</span>
                    <h3>{card.title}</h3>
                    <p>{card.body}</p>
                  </article>
                </TiltCard>
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
              <TiltCard animatedBorder className="compare-panel before">
                <p className="panel-badge">Manual path</p>
                <h3>What users struggle with</h3>
                <div className="panel-list">
                  {manualItems.map((item) => (
                    <p key={item} className="panel-item panel-item--bad">
                      <X size={13} className="panel-item-icon" />
                      {item}
                    </p>
                  ))}
                </div>
                <small>Usually 45 to 90 minutes for first-time users</small>
              </TiltCard>
              <TiltCard animatedBorder className="compare-panel after">
                <p className="panel-badge">OpenClaw Desktop</p>
                <h3>What they get instead</h3>
                <div className="panel-list">
                  {desktopItems.map((item) => (
                    <p key={item} className="panel-item panel-item--good">
                      <Check size={13} className="panel-item-icon" />
                      {item}
                    </p>
                  ))}
                </div>
                <small>Typical first run to live gateway in about 10 minutes</small>
              </TiltCard>
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
            {steps.map((step, i) => (
              <Reveal key={step.num} delay={i * 0.08}>
                <TiltCard>
                  <article className="step">
                    <div className="step-num-row">
                      <span className="step-num">{step.num}</span>
                      <span className="step-icon">{step.icon}</span>
                    </div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </article>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Download CTA */}
        <Reveal>
          <section id="download" className="shell section final-cta">
            <div className="final-cta-glow" aria-hidden="true" />
            <p className="eyebrow final-cta-eyebrow">Download</p>
            <AnimatedTitle className="final-cta-title">OpenClaw for Windows.</AnimatedTitle>
            <p className="final-cta-meta">Windows 10+ · VM &amp; RDP ready</p>
            <div className="hero-cta">
              <a className="button primary button--icon final-cta-btn" href={DOWNLOAD_URL}>
                <Monitor size={16} />
                Download for Windows
              </a>
            </div>
            <small className="final-cta-note">Free download · Subscription managed in-app</small>
          </section>
        </Reveal>
      </main>

      <footer className="shell footer">
        <p>© {year} OpenClaw Desktop</p>
      </footer>

    </>
  );
}
