import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Survivor League",
  description: "NFL survivor pool",
};

/**
 * Site chrome.
 *
 * The header is the only navigation, so it has to reflect the signed-in state —
 * otherwise a player who lands anywhere but the dashboard has no way back.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <div className="shell">
          <header className="site-header">
            <Link className="brand" href={user ? "/dashboard" : "/"}>
              Survivor League
            </Link>
            <nav aria-label="Main">
              {user ? (
                <>
                  <Link href="/dashboard">Dashboard</Link>
                  <Link href="/week">Games</Link>
                  <Link href="/rules">Rules</Link>
                  {user.isAdmin ? <Link href="/admin">Commissioner</Link> : null}
                </>
              ) : (
                <>
                  <Link href="/rules">Rules</Link>
                  <Link href="/login">Sign in</Link>
                </>
              )}
            </nav>
          </header>
          <main id="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
