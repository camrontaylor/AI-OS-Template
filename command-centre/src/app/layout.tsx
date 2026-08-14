import type { Metadata } from "next";
import "./globals.css";
import { SSEProvider } from "@/components/sse-provider";
import { TaskDetailPanel } from "@/components/panel/task-detail-panel";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Command Centre",
  description: "AI-OS Command Centre",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning style={{ overflowX: "clip" }}>
      <body
        className="antialiased"
        // overflowX: "clip" caps the layout viewport at the device width so no
        // stray wide element can inflate it and cause app-wide sub-768px
        // horizontal overflow. clip (not hidden) keeps overflow-y visible, so
        // vertical scroll and position: sticky still work. Applied inline
        // because Tailwind v4's compiler drops `overflow-x: clip` from CSS.
        style={{ fontFamily: "var(--font-inter)", overflowX: "clip" }}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <SSEProvider>
            {children}
            <TaskDetailPanel />
          </SSEProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
