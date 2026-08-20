"use client";

import { useActionState } from "react";
import { markPaidAction, settleSeasonAction, type FormState } from "@/app/actions";

/**
 * One line of the checklist: who, how much, and a place to record the reference
 * once the money has gone.
 *
 * The reference is optional but prompted, because "did I already pay Dave?" is
 * exactly the question this screen exists to answer, and a PayPal transaction id
 * answers it far better than a tick.
 */
export function PayRow({
  payoutId,
  paid,
  reference,
}: {
  payoutId: string;
  paid: boolean;
  reference: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(markPaidAction, {});

  if (paid) {
    return (
      <span className="status-ok">
        {" "}
        Paid{reference ? <span className="muted"> · {reference}</span> : null}
      </span>
    );
  }

  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="payoutId" value={payoutId} />
      <input
        type="text"
        name="reference"
        placeholder="PayPal ref (optional)"
        aria-label="Payment reference"
        size={18}
      />
      <button type="submit" className="secondary small" disabled={pending}>
        {pending ? "Saving…" : "Mark paid"}
      </button>
      {state.error ? (
        <span role="alert" className="status-bad">
          {" "}
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/**
 * Creates the payout rows once the season is decided.
 *
 * Refuses to run twice — the server will not add a second set of rows, because
 * a retry must never double what the league owes.
 */
export function SettleControl({ defaultWeek }: { defaultWeek: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(settleSeasonAction, {});

  return (
    <form action={action} className="inline-form">
      <label htmlFor="settle-week">Week just completed</label>
      <input
        id="settle-week"
        type="number"
        name="weekJustCompleted"
        defaultValue={defaultWeek}
        min={1}
        max={18}
      />
      <button type="submit" className="primary" disabled={pending}>
        {pending ? "Working…" : "Work out who gets paid"}
      </button>
      {state.ok ? (
        <span role="status" className="status-ok">
          {" "}
          {state.ok}
        </span>
      ) : null}
      {state.error ? (
        <span role="alert" className="status-bad">
          {" "}
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
