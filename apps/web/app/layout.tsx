import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { site } from "@/lib/copy";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "800"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: site.title,
  description: site.longDescription,
  applicationName: site.title,
  openGraph: { type: "website", siteName: site.title, locale: "id_ID", title: site.title, description: site.longDescription },
  twitter: { card: "summary", title: site.title, description: site.longDescription },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>
        <SiteHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
