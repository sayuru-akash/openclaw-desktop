import type { Metadata } from "next";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton
} from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenClaw Auth",
  description: "Auth service for OpenClaw Desktop"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <main>
            <div className="shell">
              <header>
                <div className="brand">OpenClaw Auth</div>
                <div className="auth-row">
                  <SignedOut>
                    <SignInButton />
                    <SignUpButton />
                  </SignedOut>
                  <SignedIn>
                    <UserButton />
                  </SignedIn>
                </div>
              </header>
              {children}
            </div>
          </main>
        </body>
      </html>
    </ClerkProvider>
  );
}
