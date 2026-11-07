import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulse — Live Vibration & Voice",
  applicationName: "Pulse",
  description: "Create vibration rhythms, connect with a partner, and talk together. Live control, preset patterns, and a shared playlist for Android Chrome.",
  appleWebApp: { title: "Pulse" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#faf9f6" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
