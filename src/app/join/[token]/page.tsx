import Link from "next/link";
import { checkInvite } from "@/lib/invites";
import { currentSeason } from "@/lib/season";
import { TERMS_VERSION, US_STATES } from "@/lib/terms";
import { formatMoney } from "@/lib/season";
import { tierConfig } from "@/rules/config";
import { SignUpForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await checkInvite(token);
  const season = await currentSeason();

  if (!invite.ok) {
    return (
      <>
        <h1>Invite link</h1>
        <div className="card">
          <p className="status-bad"> {invite.message}</p>
          <p className="muted">
            This pool is invite-only. Ask whoever invited you to send a new link.
          </p>
          <p>
            Already have an account? <Link href="/login">Sign in</Link>.
          </p>
        </div>
      </>
    );
  }

  if (!season) {
    return (
      <>
        <h1>Not ready yet</h1>
        <div className="card">
          <p>No season has been set up yet. Check back shortly.</p>
        </div>
      </>
    );
  }

  const twenty = tierConfig(season.config, "TWENTY");
  const eighty = tierConfig(season.config, "EIGHTY");
  const isPractice = season.mode === "practice";

  return (
    <>
      <h1>Join {season.name}</h1>
      <p className="muted">
        You have a valid invite. Fill this in to claim your spot.
        {isPractice
          ? " This is a practice season — there is no entry fee and no money involved."
          : " Your entry counts once the commissioner confirms your payment."}
      </p>

      <SignUpForm
        token={token}
        states={US_STATES}
        termsVersion={TERMS_VERSION}
        isPractice={isPractice}
        tiers={[
          {
            id: "TWENTY",
            label: twenty.label,
            price: isPractice ? "Free" : formatMoney(twenty.entryFeeCents),
            detail: isPractice
              ? "Practice season — no charge."
              : `Rebuys available for losses through Week ${twenty.paidRebuyRules.reduce((m, r) => Math.max(m, r.toWeek), 0)}: ${formatMoney(1000)} after a Week 1 loss, ${formatMoney(3000)} for Weeks 2–5. No rebuys after that.`,
          },
          {
            id: "EIGHTY",
            label: eighty.label,
            price: isPractice ? "Free" : formatMoney(eighty.entryFeeCents),
            detail: isPractice
              ? "Practice season — no charge."
              : `Includes ${eighty.includedRebuys} free rebuys, usable for losses through Week ${eighty.includedRebuyThroughWeek}. Unused rebuys expire after that, and extras cannot be bought.`,
          },
        ]}
      />

      <p className="muted">
        Already have an account? <Link href="/login">Sign in</Link>.
      </p>
    </>
  );
}
