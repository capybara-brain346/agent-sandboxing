import type { Metadata } from "next";
import {
  Inter as FontSans,
  IBM_Plex_Mono as FontMono,
  Plus_Jakarta_Sans as FontDisplay,
} from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import Navbar from "@/components/ui/Navbar";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";
import { MaintenanceBanner } from "@/components/ui/MaintenanceBanner";

const isMaintenanceMode = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === "true";

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = FontMono({
  weight: ["400", "500", "600"],
  display: "swap",
  subsets: ["latin"],
  variable: "--font-mono",
});

const fontDisplay = FontDisplay({
  subsets: ["latin"],
  variable: "--font-display",
});

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://capynodes-frontend.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "CapyNodes - Build. Evaluate. Learn. AI System Design",
    template: "%s | CapyNodes",
  },
  description: "The platform that evaluates your AI system designs like LeetCode evaluates code.",
  keywords: ["AI Engineering", "System Design", "ML Architecture", "Interview Prep", "Machine Learning", "RAG", "LLM Ops", "AI Infrastructure", "System Architecture", "Design Patterns", "Vector Databases", "MLOps"],
  authors: [{ name: "CapyNodes", url: "https://piyushchoudhari.me/" }],
  creator: "Piyush Choudhari",
  publisher: "CapyNodes",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon/favicon.ico", sizes: "any" },
    ],
    apple: [
      { url: "/favicon/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: baseUrl,
    siteName: "CapyNodes",
    title: "CapyNodes - Build. Evaluate. Learn. AI System Design",
    description: "The platform that evaluates your AI system designs like LeetCode evaluates code.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "CapyNodes - Build. Evaluate. Learn. AI System Design",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CapyNodes - Build. Evaluate. Learn. AI System Design",
    description: "The platform that evaluates your AI system designs like LeetCode evaluates code.",
    images: ["/og-image.png"],
    creator: "@capynodes",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${fontSans.variable} ${fontMono.variable} ${fontDisplay.variable} antialiased bg-background text-foreground transition-colors duration-300`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <GoogleAnalytics />
          {isMaintenanceMode && <MaintenanceBanner />}
          <AuthProvider>
            <Navbar maintenanceMode={isMaintenanceMode} />
            {isMaintenanceMode && <div className="h-12" />}
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
