"use client";

import { useActionState } from "react";
import { takeRebuy, type FormState } from "@/app/actions";

export function RebuyPanel({
  rebuyId,
  kind,
  price,
  lossWeek,
  remaining,
  paypal,
  transferType,
  playerName,
}: {
  rebuyId: string;
  kind: "included" | "paid";
  price: string;
  lossWeek: number;
  remaining: number;
  paypal: string;
  transferType: string;
  playerName: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(takeRebuy, {});

  return (
    <div className="card callout-warning">
      <h2 style={{ marginTop: 0 }}>You lost in Week {lossWeek}</h2>

      {kind === "included" ? (
        <p>
          You have a <strong>free rebuy</strong> included with your entry — {remaining} left. Using
          it puts you straight back in.
        </p>
      ) : (
        <>
          <p>
            You can buy back in for <strong>{price}</strong>.
          </p>
          <div className="pay-instructions">
            <p style={{ marginTop: 0 }}>
              Send <strong>{price}</strong> by PayPal to:
            </p>
            <p className="pay-address">{paypal}</p>
            <ul style={{ marginBottom: 0 }}>
              <li>
                Send as <strong>{transferType}</strong>, not goods and services.
              </li>
              <li>
                Put <strong>{playerName}</strong> and &ldquo;rebuy&rdquo; in the note.
              </li>
            </ul>
          </div>
          <p className="muted">You are not back in until the commissioner confirms it.</p>
        </>
      )}

      <p className="muted">
        The teams you have already used stay used. A rebuy never gives them back.
      </p>

      {state.error ? (
        <p role="alert" className="status-bad"> {state.error}</p>
      ) : null}
      {state.ok ? <p role="status" className="status-ok"> {state.ok}</p> : null}

      <div className="button-row">
        <form action={action}>
          <input type="hidden" name="rebuyId" value={rebuyId} />
          <input type="hidden" name="decision" value="accept" />
          <button type="submit" disabled={pending} className="primary">
            {pending ? "Working…" : kind === "included" ? "Use my free rebuy" : "Buy back in"}
          </button>
        </form>
        <form action={action}>
          <input type="hidden" name="rebuyId" value={rebuyId} />
          <input type="hidden" name="decision" value="decline" />
          <button type="submit" disabled={pending} className="secondary">
            No thanks — I&rsquo;m out
          </button>
        </form>
      </div>
    </div>
  );
}
