import type { Metadata } from "next";
import { DM_Mono, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { SSEProvider } from "@/components/sse-provider";
import { TaskDetailPanel } from "@/components/panel/task-detail-panel";
import { ThemeProvider } from "@/components/theme-provider";
import { LocalProfileBoundary } from "@/components/local-profile-boundary";
import { THEME_BOOTSTRAP_SCRIPT } from "@/design-system/theme-preference";
import { toBrowserLocalProfile } from "@/lib/local-profile";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
});

// Epilogue for headlines — loaded via next/font/google
import { Epilogue } from "next/font/google";
const epilogue = Epilogue({
  subsets: ["latin"],
  variable: "--font-epilogue",
});

export const metadata: Metadata = {
  title: "Command Centre",
  description: "AI-OS Command Centre",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let localProfile;
  try {
    localProfile = toBrowserLocalProfile();
  } catch {
    localProfile = { version: 1 as const, mode: "team" as const, profileKey: "locked", sessionId: "locked" };
  }
  const profileBootstrap = `(()=>{const p=${JSON.stringify(localProfile).replace(/</g, "\\u003c")};window.__COMMAND_CENTRE_PROFILE__=p;const f=window.fetch.bind(window);window.fetch=(input,init={})=>{try{const raw=typeof input==="string"?input:input instanceof URL?input.href:input.url;const u=new URL(raw,window.location.href);if(u.origin===window.location.origin&&u.pathname.startsWith("/api/")){const h=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers||{}).forEach((v,k)=>h.set(k,v));h.set("x-AI-OS-profile-key",p.profileKey);h.set("x-AI-OS-profile-session",p.sessionId);return f(input,{...init,headers:h});}}catch{}return f(input,init);};})();`;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable} ${dmMono.variable} ${epilogue.variable}`}
    >
      <head>
        <script
          id="command-centre-theme"
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
        <script
          id="command-centre-local-profile"
          dangerouslySetInnerHTML={{ __html: profileBootstrap }}
        />
      </head>
      <body
        className="antialiased"
        style={{ fontFamily: "var(--font-inter), Inter, sans-serif" }}
      >
        <ThemeProvider>
          <LocalProfileBoundary>
            <SSEProvider>
              {children}
              <TaskDetailPanel />
            </SSEProvider>
          </LocalProfileBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
