import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ShieldIcon } from "@/components/icons";
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
  title: "Medical Document Fraud Check",
  description: "Detect forged, tampered and AI-generated medical documents",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-10 border-b border-line bg-card/80 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2.5 px-4 sm:px-6">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-lg text-white dark:text-[#0c0e13]">
              <ShieldIcon />
            </span>
            <span className="font-semibold text-ink">Fraud Docs</span>
            <span className="ml-1 hidden text-sm text-muted sm:inline">Medical document verification</span>
          </div>
        </header>
        {children}
        <footer className="border-t border-line">
          <p className="mx-auto w-full max-w-7xl px-4 py-6 text-xs leading-5 text-muted sm:px-6">
            Results are automated indicators, not proof. Always confirm suspicious documents with the issuing provider
            before taking action. Uploaded files are processed in memory and are not stored by this app.
          </p>
        </footer>
      </body>
    </html>
  );
}
