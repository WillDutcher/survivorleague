import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Survivor League",
  description: "NFL survivor pool",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <div className="shell">
          <header className="site-header">
            <a className="brand" href="/">
              Survivor League
            </a>
          </header>
          <main id="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
