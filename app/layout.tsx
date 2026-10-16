import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "James Journal",
  description: "Our shared spot for lining up hours with James each week.",
  openGraph: {
    title: "James Journal",
    description: "Our shared spot for lining up hours with James each week.",
  },
  appleWebApp: { title: "James Journal" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
