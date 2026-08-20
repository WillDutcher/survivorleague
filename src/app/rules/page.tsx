import Link from "next/link";
import { AskCommissioner } from "@/app/ask-commissioner";
import { currentSeason, formatMoney } from "@/lib/season";
import { TERMS, TERMS_VERSION } from "@/lib/terms";
import { SEASON_2026, tierConfig } from "@/rules/config";

export const dynamic = "force-dynamic";

/**
 * The player-facing rules page (D18a).
 *
 * Every number here is read from the same SeasonConfig the rule engine executes.
 * Change a price or a window in config and this page changes with it — the rules
 * as published and the rules as enforced cannot drift apart, which is the thing
 * that starts arguments.
 */
export default async function RulesPage() {
  const season = await currentSeason();
  const config = season?.config ?? SEASON_2026;
  const twenty = tierConfig(config, "TWENTY");
  const eighty = tierConfig(config, "EIGHTY");

  const twentyWeek1 = twenty.paidRebuyRules.find((r) => r.fromWeek === 1);
  const twentyLater = twenty.paidRebuyRules.find((r) => r.fromWeek > 1);
  const twentyLastWeek = twenty.paidRebuyRules.reduce((m, r) => Math.max(m, r.toWeek), 0);

  return (
    <>
      <h1>League rules</h1>
      <p className="muted">
        {season?.name ?? `${config.year} Survivor League`} · terms version {TERMS_VERSION}
      </p>
      <p className="muted hint">
        This page is generated from the same configuration the application enforces. What you read
        here is exactly what the server applies.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>How it works</h2>
        <ul>
          <li>Each week you pick one NFL team. That team must win for you to survive.</li>
          <li>
            <strong>You cannot use the same team twice all season.</strong> This survives rebuys —
            a team you used before a loss stays used afterward.
          </li>
          <li>A loss ends your entry unless a rebuy is available to you.</li>
          <li>The last player standing wins the pot.</li>
        </ul>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Ties</h2>
        <p>
          A tie is neither a win nor a loss. You stay alive, but you owe more the following week:
          each tie must be made good with <strong>{config.tieMultiplier} winning picks</strong>.
        </p>
        <ul>
          <li>Tie one game → you must win {config.tieMultiplier} games next week.</li>
          <li>
            Wins do not reduce the debt. If you owe 2 and go win-plus-tie, you owe{" "}
            {config.tieMultiplier} again.
          </li>
          <li>
            Tie both games while owing 2 → you owe {config.tieMultiplier * 2} next week.
          </li>
          <li>
            <strong>Any loss in a multi-pick week is a loss</strong>, no matter what the other
            picks did.
          </li>
          <li>All picks in a multi-pick week still follow the no-reuse rule.</li>
        </ul>
        {config.tieInFinalWeekIsLoss ? (
          <p>
            <strong>A tie in Week {config.finalWeek} is a loss.</strong> There is no following week
            in which to pay the debt, and you do not advance on a tie.
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Deadlines</h2>
        <ul>
          <li>
            Normal deadline is <strong>Sunday {formatTime(config.sundayDeadline)} Eastern</strong>.
          </li>
          <li>
            If you pick a team playing before that, your pick locks{" "}
            <strong>{config.earlyGameLockLeadMinutes} minutes before that kickoff</strong> —
            Thursday, Saturday, and international games included.
          </li>
          <li>You can change a pick any time before it locks.</li>
          <li>
            Miss the deadline and you are assigned the <strong>strongest available favorite</strong>{" "}
            by the league&rsquo;s locked point spread, from teams still legal for you. This is
            automatic and deterministic.
          </li>
        </ul>
        <p className="muted">
          Point spreads are shown for information and to decide default picks only. They never
          determine whether you survive — your pick either wins or it does not.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Entry options and rebuys</h2>

        <h3>{twenty.label} — {formatMoney(twenty.entryFeeCents)}</h3>
        <ul>
          {twentyWeek1 ? (
            <li>
              Lose in Week 1: rebuy for <strong>{formatMoney(twentyWeek1.priceCents)}</strong>. This
              price applies to Week 1 only.
            </li>
          ) : null}
          {twentyLater ? (
            <li>
              Lose in Weeks {twentyLater.fromWeek}–{twentyLater.toWeek}: rebuy for{" "}
              <strong>{formatMoney(twentyLater.priceCents)}</strong>. No exceptions.
            </li>
          ) : null}
          <li>Rebuys are unlimited within that window.</li>
          <li>
            <strong>A loss in Week {twentyLastWeek + 1} or later ends your entry.</strong>
          </li>
        </ul>

        <h3>{eighty.label} — {formatMoney(eighty.entryFeeCents)}</h3>
        <ul>
          <li>
            Includes <strong>{eighty.includedRebuys} free rebuys</strong>, usable for losses through
            Week {eighty.includedRebuyThroughWeek}.
          </li>
          <li>
            <strong>Unused rebuys expire.</strong> A clean sheet with all {eighty.includedRebuys}{" "}
            unused plus a loss in Week {eighty.includedRebuyThroughWeek + 1} means you are out.
          </li>
          <li>Extra rebuys cannot be purchased on this option, at any point.</li>
        </ul>

        <p className="muted">
          A rebuy clears any outstanding tie requirement, but never clears your used-team history.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Winning and splitting</h2>
        <ul>
          <li>Last player standing takes the pot.</li>
          <li>
            After each week, the remaining players may agree to split.{" "}
            <strong>It must be unanimous.</strong> One objection ends the option and play continues.
          </li>
          <li>
            A split does <strong>not</strong> have to be equal. Any division the remaining players
            all agree to is valid.
          </li>
          <li>
            <strong>Not responding counts as no.</strong> The vote closes when the next week&rsquo;s
            first game kicks off.
          </li>
          <li>
            If more than one player is still alive after Week {config.finalWeek}, the pot splits
            evenly among them.
          </li>
        </ul>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Terms of participation</h2>
        <p className="muted hint">Version {TERMS_VERSION}</p>
        {TERMS.map((section) => (
          <section key={section.heading}>
            <h3>{section.heading}</h3>
            {section.body.map((paragraph) => (
              <p key={paragraph.slice(0, 40)}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>

      <div className="card">
        <AskCommissioner subject="Question about the rules">
          Anything here unclear, or a situation the rules do not seem to cover? Ask before it
          matters rather than after — the{" "}
          <Link href="/faq">questions people actually ask</Link> page may cover it already.
        </AskCommissioner>
      </div>
    </>
  );
}

function formatTime({ hour, minute }: { hour: number; minute: number }): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`;
}
