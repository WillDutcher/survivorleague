"use client";

import { useActionState } from "react";
import { nudgeMissing, type FormState } from "@/app/actions";

/**
 * Commissioner-only: email everyone who still owes a pick this week.
 *
 * The count is rendered into the label so the button says exactly how many
 * people it is about to mail, rather than making the commissioner guess.
 * Disabled at zero — the "everyone has picked" case is worth showing as a
 * state, not as an error after the fact.
 */
export function NudgeButton({ weekNumber, missing }: { weekNumber: number; missing: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(nudgeMissing, {});

  return (
    <form action={action} className="nudge-form">
      <input type="hidden" name="weekNumber" value={weekNumber} />
      <button type="submit" className="secondary small" disabled={pending || missing === 0}>
        {pending
          ? "Sending…"
          : missing === 0
            ? "Everyone has picked"
            : `Remind ${missing} who ${missing === 1 ? "has" : "have"} not picked`}
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
