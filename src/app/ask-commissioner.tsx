import { commissionerEmail, commissionerMailto, LEAGUE } from "@/lib/league";

/**
 * The one way to reach a human, shown everywhere someone might get stuck.
 *
 * Deliberately repeated rather than tucked on a contact page. The moments when
 * a player needs this are the moments they are least willing to go hunting: a
 * pick that will not save, a payment that has not shown up, ten minutes before
 * a deadline.
 *
 * The address is rendered as text as well as a link. Plenty of people read this
 * on a phone with no mail client configured, and a mailto that opens nothing is
 * worse than an address they can copy.
 */
export function AskCommissioner({
  subject = "Question",
  children,
}: {
  /** Pre-filled subject, so the commissioner's inbox is sortable. */
  subject?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="ask-commissioner">
      <p style={{ marginTop: 0 }}>
        {children ?? (
          <>
            Stuck, or something looks wrong? Email {LEAGUE.commissionerName}. A real person reads
            it, and a genuine mistake can be corrected.
          </>
        )}
      </p>
      <p className="ask-address">
        <a href={commissionerMailto(subject)}>{commissionerEmail()}</a>
      </p>
      <p className="muted hint" style={{ marginBottom: 0 }}>
        If a deadline is close, say so in the subject line — that is the one time a reply
        genuinely cannot wait.
      </p>
    </div>
  );
}
