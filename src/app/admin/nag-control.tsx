"use client";

import { useActionState } from "react";
import { runPaymentReminders, type FormState } from "@/app/actions";

export function NagControl({
  outstanding,
  history,
}: {
  outstanding: number;
  history: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(runPaymentReminders, {});

  return (
    <div className="week-control">
      <form action={action}>
        <button type="submit" disabled={pending || outstanding === 0} className="secondary">
          {pending ? "Sending…" : "Send payment reminders"}
        </button>
      </form>
      <p className="muted hint">
        Escalating sequence — a gentle note after 2 days, firmer at 6, last call at 12. Each step
        goes out at most once per player, so running this repeatedly is safe. This is the nagging
        you used to do by hand.
      </p>
      {history.length > 0 ? (
        <p className="muted hint">Already sent — {history.join(" · ")}</p>
      ) : null}
      {state.error ? <p role="alert" className="status-bad hint"> {state.error}</p> : null}
      {state.ok ? <p role="status" className="status-ok hint"> {state.ok}</p> : null}
    </div>
  );
}
