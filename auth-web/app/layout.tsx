import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
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
    <ClerkProvider appearance={{ baseTheme: dark }}>
      <html lang="en">
        <body>
          <main>
            <div className="brand-header">OpenClaw</div>
            {children}
          </main>
        </body>
      </html>
    </ClerkProvider>
  );
}
