import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://codex-1-five.vercel.app"),
  title: {
    default: "Codex Pilot — Autonomous GitHub Issue Solver",
    template: "%s · Codex Pilot",
  },
  description: "Autonomous GitHub issue investigation with visible repository evidence and reviewable patches.",
  openGraph: {
    title: "Codex Pilot — Autonomous GitHub Issue Solver",
    description: "Paste a public GitHub issue. Watch Codex investigate the repository and prepare a patch.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Pilot",
    description: "Agentic coding, visible.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
