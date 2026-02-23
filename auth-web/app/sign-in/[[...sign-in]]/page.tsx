import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="auth-page">
      <img src="/openclaw_logo_light_theme.png" alt="OpenClaw" className="auth-logo" />
      <SignIn />
    </div>
  );
}
