import Link from "next/link";
import { currentSeason, formatMoney } from "@/lib/season";
import { tierConfig } from "@/rules/config";
import { SEASON_2026 } from "@/rules/config";

export const dynamic = "force-dynamic";

/**
 * The questions people actually ask, as opposed to the rules as written.
 *
 * `/rules` is the canonical statement and this deliberately does not restate
 * it. Everything here is a SCENARIO — the situations that have historically
 * produced an argument, a text message to the commissioner, or a wrong
 * assumption that only surfaced after someone was already eliminated.
 *
 * Written in the second person and in plain language on purpose. Somebody
 * reading this is usually mid-panic on a Sunday morning.
 */

interface QA {
  q: string;
  a: React.ReactNode;
}

export default async function FaqPage() {
  const season = await currentSeason();
  const config = season?.config ?? SEASON_2026;
  const twenty = tierConfig(config, "TWENTY");
  const eighty = tierConfig(config, "EIGHTY");

  const lastPaidWeek = twenty.paidRebuyRules.reduce((m, r) => Math.max(m, r.toWeek), 0);

  const sections: Array<{ heading: string; items: QA[] }> = [
    {
      heading: "Making picks",
      items: [
        {
          q: "How many teams do I pick each week?",
          a: (
            <>
              <p>
                One. You pick a single team you think will win, and if they win you move on to
                next week.
              </p>
              <p>
                The one exception is after a tie — see the tie questions below, which are the
                part everybody gets wrong.
              </p>
            </>
          ),
        },
        {
          q: "Can I pick the same team twice?",
          a: (
            <p>
              No. Once you have used a team, they are gone for the rest of the season, win or
              lose. This is the whole strategic tension of survivor: burning Kansas City in Week
              2 feels great until Week 14.
            </p>
          ),
        },
        {
          q: "Can I make picks for future weeks in advance?",
          a: (
            <>
              <p>
                Yes, and it is worth doing if you are going to be away. Pick any week that is
                loaded.
              </p>
              <p>
                A future pick reserves that team. If you try to use them sooner, the app will
                tell you they are already committed to a later week rather than silently letting
                you double-book.
              </p>
            </>
          ),
        },
        {
          q: "Can I change my mind?",
          a: (
            <p>
              Any time before the pick locks. Tap your selected team again to remove it, or just
              pick someone else. Once it locks it is final.
            </p>
          ),
        },
      ],
    },
    {
      heading: "Deadlines and locking",
      items: [
        {
          q: "When exactly is the deadline?",
          a: (
            <>
              <p>
                <strong>
                  {config.sundayDeadline.hour > 12
                    ? config.sundayDeadline.hour - 12
                    : config.sundayDeadline.hour}
                  :{String(config.sundayDeadline.minute).padStart(2, "0")} PM Eastern on Sunday
                </strong>{" "}
                for the main slate.
              </p>
              <p>
                <strong>But any game kicking off earlier locks separately</strong>, five minutes
                before its own kickoff. A Thursday night game locks Thursday. A London game at
                9:30 AM locks at 9:25 AM.
              </p>
              <p>
                Every game on the pick screen shows its own lock time. Do not rely on the Sunday
                deadline if you are picking a team that plays before Sunday afternoon.
              </p>
            </>
          ),
        },
        {
          q: "The site says I locked but I swear I submitted in time",
          a: (
            <>
              <p>
                The server decides, not your browser. Your clock, your phone&apos;s timezone and
                a slow connection all fail in the direction of thinking you had more time.
              </p>
              <p>
                That said, if something genuinely went wrong — the page hung, the app errored —
                email the commissioner. There is a way to correct a pick, it is logged, and it is
                there precisely for this.
              </p>
            </>
          ),
        },
        {
          q: "What happens if I just forget?",
          a: (
            <>
              <p>
                You are not eliminated for forgetting. You are assigned the{" "}
                <strong>strongest available favourite</strong> — the biggest favourite by the
                league&apos;s locked spread among the teams you have not used.
              </p>
              <p>
                This is deterministic, not the commissioner&apos;s opinion: same inputs, same
                answer, every time. It is often a fine pick. It is never a pick you chose, and it
                burns that team for the rest of the season.
              </p>
            </>
          ),
        },
      ],
    },
    {
      heading: "Ties — the part that confuses everyone",
      items: [
        {
          q: "My team tied. Am I out?",
          a: (
            <>
              <p>
                No. A tie keeps you alive. But it raises the price of staying alive:{" "}
                <strong>
                  next week you must pick {config.tieMultiplier} teams and they must{" "}
                  <em>both</em> win.
                </strong>
              </p>
              <p>
                Two separate teams, two separate games. If either one loses, you are out.
              </p>
            </>
          ),
        },
        {
          q: "I owed two picks and one of them tied. Now what?",
          a: (
            <>
              <p>
                It doubles again. Each tie multiplies your requirement by {config.tieMultiplier}.
              </p>
              <p>
                Owed 2, one tied and the other won → you owe {2 * config.tieMultiplier} next
                week. Owed 2 and <em>both</em> tied → you owe{" "}
                {2 * config.tieMultiplier * config.tieMultiplier}. This escalates fast, which is
                the point: a tie is a reprieve, not a free pass.
              </p>
            </>
          ),
        },
        {
          q: "I owed two picks. One tied and the other lost.",
          a: (
            <p>
              You are out. <strong>Any loss ends your entry</strong>, regardless of what the other
              picks did. A loss is never cancelled out by a win or a tie elsewhere.
            </p>
          ),
        },
        {
          q: `What if I tie in Week ${config.finalWeek}?`,
          a: (
            <p>
              {config.tieInFinalWeekIsLoss ? (
                <>
                  That is a loss. There is no Week {config.finalWeek + 1} to pick two winners in,
                  so the reprieve has nowhere to go. You do not advance on a tie.
                </>
              ) : (
                <>You survive, and the season settles among everyone still alive.</>
              )}
            </p>
          ),
        },
      ],
    },
    {
      heading: "Rebuys",
      items: [
        {
          q: "I lost. Can I buy back in?",
          a: (
            <>
              <p>
                Depends which entry you bought.
              </p>
              <p>
                <strong>{eighty.label}:</strong> you get {eighty.includedRebuys} rebuys included,
                free, usable through Week {eighty.includedRebuyThroughWeek}. After that week they
                expire whether you used them or not, and you cannot buy extras.
              </p>
              <p>
                <strong>{twenty.label}:</strong> unlimited rebuys, but you pay each time and only
                through Week {lastPaidWeek}.{" "}
                {twenty.paidRebuyRules
                  .map((r) =>
                    r.fromWeek === r.toWeek
                      ? `Week ${r.fromWeek} costs ${formatMoney(r.priceCents)}`
                      : `Weeks ${r.fromWeek}–${r.toWeek} cost ${formatMoney(r.priceCents)}`,
                  )
                  .join("; ")}
                .
              </p>
            </>
          ),
        },
        {
          q: "Does a rebuy give me my used teams back?",
          a: (
            <>
              <p>
                <strong>No.</strong> This is the single most common wrong assumption in the
                league.
              </p>
              <p>
                Your used-team history follows you for the whole season. If you burned six teams
                before being eliminated, you come back with those same six gone. A rebuy buys you
                back into the game, not a fresh start.
              </p>
            </>
          ),
        },
        {
          q: "I tied, then lost, then rebought. Do I still owe two picks?",
          a: (
            <p>
              {config.rebuyClearsTieDebt ? (
                <>
                  No. A rebuy resets you to one pick per week. The doubled requirement died with
                  the entry that incurred it.
                </>
              ) : (
                <>Yes — the doubled requirement carries through the rebuy.</>
              )}
            </p>
          ),
        },
        {
          q: "I paid for my rebuy. Why am I still showing as out?",
          a: (
            <p>
              A paid rebuy activates when the commissioner confirms the money arrived, not when
              you send it. Included ({eighty.label}) rebuys are instant because there is nothing
              to confirm. If it has been a while, nudge them — PayPal notifications get buried.
            </p>
          ),
        },
      ],
    },
    {
      heading: "Money and the end of the season",
      items: [
        {
          q: "Who holds the money, and does anyone take a cut?",
          a: (
            <>
              <p>
                Entry fees go to the commissioner&apos;s PayPal and back out to the winners.{" "}
                <strong>Nobody takes a rake.</strong> There is no house cut, no fee, no
                administrative skim.
              </p>
              <p>
                The app itself never touches money in either direction. It works out who is owed
                what and keeps the record; a human sends every payment by hand.
              </p>
            </>
          ),
        },
        {
          q: "How does the pot get split if several of us are left?",
          a: (
            <>
              <p>
                After any week, any survivor can propose splitting the pot. It only happens if{" "}
                <strong>every remaining survivor agrees</strong> — one no and it is off, and the
                season continues.
              </p>
              <p>
                Silence counts as no. If you do not vote before the next week kicks off, the
                proposal dies.
              </p>
            </>
          ),
        },
        {
          q: "Can we agree to an uneven split?",
          a: (
            <>
              <p>
                Yes, and this has happened before. Three left, two want to stop, one wants to
                play on — so the two paying people give up some of their share to buy him out.
              </p>
              <p>
                Propose whatever numbers you all agree to. The only hard requirement is that the
                amounts add up to exactly the pot. It still needs everyone&apos;s yes.
              </p>
            </>
          ),
        },
        {
          q: `What if several of us survive all ${config.finalWeek} weeks?`,
          a: (
            <p>
              The pot splits evenly between everyone still alive. If it does not divide evenly,
              the odd cents are distributed rather than dropped — the payouts always add back up
              to exactly what was collected.
            </p>
          ),
        },
        {
          q: "When do I actually get paid?",
          a: (
            <p>
              Once the season is settled, the commissioner sends each payment manually and ticks
              it off. If you are owed money and have not seen it, ask — there is a checklist and
              it will say plainly whether yours has been sent.
            </p>
          ),
        },
      ],
    },
    {
      heading: "The app itself",
      items: [
        {
          q: "Why can I not see what everyone else picked?",
          a: (
            <>
              <p>
                Other players&apos; picks appear once <strong>their game kicks off</strong>, not
                when picks lock. Somebody on the Monday night game stays hidden through all of
                Sunday.
              </p>
              <p>
                The standings do show whether someone <em>has</em> picked — &ldquo;pick made,
                hidden until kickoff&rdquo; is deliberately different from &ldquo;no pick
                yet&rdquo;. You can see who is dragging their feet without seeing their hand.
              </p>
            </>
          ),
        },
        {
          q: "The spread I see now is different from the one on my pick screen",
          a: (
            <p>
              The league uses a spread frozen on Thursday. It never moves afterwards, even if the
              real line does. That frozen number is what decides default picks, so a line that
              drifted over the weekend cannot retroactively change a decision that was already
              made.
            </p>
          ),
        },
        {
          q: "Do spreads matter to whether I survive?",
          a: (
            <p>
              No. Your team just has to win. Spreads are shown for information and are used only
              to rank default picks for people who missed the deadline.
            </p>
          ),
        },
        {
          q: "Something looks wrong. What do I do?",
          a: (
            <p>
              Email the commissioner. Corrections are possible and are logged with a reason —
              there is a real audit trail, so raising it costs you nothing and a genuine mistake
              can be fixed.
            </p>
          ),
        },
      ],
    },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Questions people actually ask</h1>
          <p className="muted">
            The rules as written are on the <Link href="/rules">rules page</Link>. This is the
            &ldquo;wait, what happens if…&rdquo; version.
          </p>
        </div>
        <Link href="/dashboard">Back to dashboard</Link>
      </div>

      {sections.map((section) => (
        <div className="card" key={section.heading}>
          <h2 style={{ marginTop: 0 }}>{section.heading}</h2>
          {section.items.map((item) => (
            <details className="faq-item" key={item.q}>
              <summary>{item.q}</summary>
              <div className="faq-answer">{item.a}</div>
            </details>
          ))}
        </div>
      ))}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Still stuck?</h2>
        <p>
          Email the commissioner. If it is close to a deadline, say so in the subject line — that
          is the one time a reply genuinely cannot wait.
        </p>
      </div>
    </>
  );
}
