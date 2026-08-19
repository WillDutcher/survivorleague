import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { currentSeason } from "@/lib/season";

export const dynamic = "force-dynamic";

/**
 * Landing page.
 *
 * A signed-in player never sees this — they go straight to their dashboard.
 * Anyone else gets a sign-in route and an honest statement that the pool is
 * invite-only, so there is no dead end and no misleading "sign up" affordance
 * for someone without a link.
 *
 * Environment diagnostics live at /status.
 */
export default async function Home() {
  const user = await currentUser();
  if (user) redirect("/dashboard");

  const season = await currentSeason();

  return (
    <>
      <h1>{season?.name ?? "Survivor League"}</h1>
      <p className="muted">
        A private NFL survivor pool. Pick one team a week, that team has to win, and you can never
        use the same team twice.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Already playing?</h2>
        <p>
          <Link href="/login">Sign in</Link> with the email address you registered.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Want in?</h2>
        <p>
          This pool is <strong>invite-only</strong> — you need a link from someone already in it.
          There is no open sign-up.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          You can read the <Link href="/rules">full rules and terms</Link> before deciding.
        </p>
      </div>
    </>
  );
}
