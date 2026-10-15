import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { ClerkProviderWrapper } from "@/components/clerk-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Footnote — Research notebooks that cite their sources",
  description:
    "Upload PDFs, websites, YouTube videos, and transcripts, then ask questions answered only from what you gave it — every claim traceable to the exact page, timestamp, or passage.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  openGraph: {
    title: "Footnote — Research notebooks that cite their sources",
    description:
      "Ask questions across your PDFs, sites, and videos and get answers footnoted back to the exact source.",
    siteName: "Footnote",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Footnote — Research notebooks that cite their sources",
    description: "Every answer traces back to a source. No guessing.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          <ClerkProviderWrapper>
            {children}
          </ClerkProviderWrapper>
        </Providers>
      </body>
    </html>
  );
}