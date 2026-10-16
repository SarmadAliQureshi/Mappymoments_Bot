import type { Metadata } from "next";
import { Inter, Lora } from "next/font/google";
import SiteNav from "@/components/SiteNav";
import "./globals.css";

const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-lora",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["200", "400", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mappy Moments Image Generator",
  description: "Generate on-brand Mappy Moments imagery from a simple prompt.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${lora.variable} ${inter.variable}`}>
      <body className="min-h-screen bg-parchment font-sans text-ink antialiased">
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
