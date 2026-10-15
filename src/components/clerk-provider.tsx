"use client";

import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export function ClerkProviderWrapper({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === "dark";

  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "hsl(var(--primary))",
          colorBackground: "hsl(var(--background))",
          colorInput: "hsl(var(--input))",
          colorInputForeground: "hsl(var(--foreground))",
          colorForeground: "hsl(var(--foreground))",
          colorMutedForeground: "hsl(var(--muted-foreground))",
          colorNeutral: "hsl(var(--muted-foreground))",
          borderRadius: "var(--radius)",
          fontFamily: "var(--font-sans)",
        },
        elements: {
          card: "bg-card border border-border shadow-xl",

          headerTitle: "text-foreground",
          headerSubtitle: "text-muted-foreground",

          formFieldLabel: "text-muted-foreground",
          formFieldInput:
            "bg-input border-border text-foreground focus:border-ring",

          formButtonPrimary:
            "bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg",

          socialButtonsBlockButton:
            "bg-card hover:bg-accent border border-border text-foreground rounded-lg",

          socialButtonsBlockButtonText: "text-foreground font-medium",

          footerActionText: "text-muted-foreground",
          footerActionLink: "text-primary hover:underline",

          socialButtonsProviderIcon: isDark ? "brightness-0 invert" : "",
          userButtonPopoverCard:
            "bg-popover border border-border shadow-xl rounded-xl",
          userButtonPopoverMain: "bg-popover",
          userButtonPopoverActions: "bg-popover",
          userButtonPopoverActionButton:
            "text-foreground hover:bg-accent data-[hovered]:bg-accent",
          userButtonPopoverActionButtonText: "text-foreground font-medium",
          userButtonPopoverActionButtonIcon: "text-muted-foreground",
          userButtonPopoverFooter: "bg-popover border-t border-border",
          userPreviewMainIdentifier: "text-foreground font-medium",
          userPreviewSecondaryIdentifier: "text-muted-foreground",
        },
      }}
    >
      <div className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        {children}
        <Toaster
          theme={isDark ? "dark" : "light"}
          position="bottom-right"
          richColors
          closeButton
        />
      </div>
    </ClerkProvider>
  );
}