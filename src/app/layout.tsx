import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

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

// Without this, mobile browsers assume a ~980px desktop-width layout and
// scale the whole page down to fit, which is why Tailwind's responsive
// breakpoints (sm:/lg:/etc.) don't behave correctly on real phones — they're
// evaluated against that fake wide viewport, not the device's actual width.
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
    <ClerkProvider
   appearance={{
         variables: {
      colorPrimary: "#C9A8FF",
      colorBackground: "#12151C",
      colorInput: "#0B0E14",
      colorInputForeground: "#ECEEF2",
      colorForeground: "#ECEEF2",
      colorMutedForeground: "#8A8FA3",
      colorNeutral: "#8A8FA3",
      borderRadius: "0.85rem",
      fontFamily: "var(--font-sans)",
    },
        elements: {
          card: "bg-zinc-900 border border-zinc-800 shadow-2xl",

          headerTitle: "text-white",
          headerSubtitle: "text-zinc-400",

          formFieldLabel: "text-zinc-300",
          formFieldInput:
            "bg-zinc-950 border-zinc-700 text-white focus:border-purple-500",

          formButtonPrimary:
            "bg-purple-600 hover:bg-purple-700 text-white rounded-lg",

          socialButtonsBlockButton:
            "bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white rounded-lg",

          socialButtonsBlockButtonText: "text-white font-medium",

          footerActionText: "text-zinc-400",
          footerActionLink: "text-purple-400 hover:text-purple-300",

          socialButtonsProviderIcon: "brightness-0 invert",
          userButtonPopoverCard:
            "bg-zinc-900 border border-zinc-800 shadow-2xl rounded-xl",
          userButtonPopoverMain: "bg-zinc-900",
          userButtonPopoverActions: "bg-zinc-900",
          userButtonPopoverActionButton:
            "text-zinc-200 hover:bg-white/10 data-[hovered]:bg-white/10",
          userButtonPopoverActionButtonText: "text-zinc-200 font-medium",
          userButtonPopoverActionButtonIcon: "text-zinc-300",
          userButtonPopoverFooter: "bg-zinc-900 border-t border-zinc-800",
          userPreviewMainIdentifier: "text-white font-medium",
          userPreviewSecondaryIdentifier: "text-zinc-400",
        },
      }}
>
      <html lang="en" className="dark" suppressHydrationWarning>
        <body
          className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased`}
        >
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            richColors
            closeButton
          />
        </body>
      </html>
    </ClerkProvider>
  );
}