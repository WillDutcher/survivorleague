"use client";

import { useActionState } from "react";
import { lockLines, runDefaults, runResults, type FormState } from "@/app/actions";

function Control({
  action,
  label,
  hint,
  defaultWeek,
  variant = "secondary",
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  label: string;
  hint: string;
  defaultWeek: number;
  variant?: "primary" | "secondary";
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const id = label.replace(/\s+/g, "-").toLowerCase();

  return (
    <div className="week-control">
      <form action={formAction} className="inline-form">
        <label htmlFor={id}>Week</label>
        <input id={id} name="weekNumber" type="number" min={1} max={18} defaultValue={defaultWeek} />
        <button type="submit" disabled={pending} className={variant}>
          {pending ? "Working…" : label}
        </button>
      </form>
      <p className="muted hint">{hint}</p>
      {state.error ? <p role="alert" className="status-bad hint"> {state.error}</p> : null}
      {state.ok ? <p role="status" className="status-ok hint"> {state.ok}</p> : null}
    </div>
  );
}

export function WeekControls({ defaultWeek }: { defaultWeek: number }) {
  return (
    <>
      <Control
        action={lockLines}
        label="Lock league lines"
        defaultWeek={defaultWeek}
        hint="Freezes this week's spreads. The locked snapshot is what every later decision uses, even if the real line moves. Do this Thursday."
      />
      <Control
        action={runDefaults}
        label="Assign default picks"
        defaultWeek={defaultWeek}
        hint="Gives the strongest legal favourite to anyone short of their requirement. Deterministic — the same inputs always give the same answer, so running it late changes nothing."
      />
      <Control
        action={runResults}
        label="Process results"
        defaultWeek={defaultWeek}
        variant="primary"
        hint="Grades every pick, applies the tie rule, and offers rebuys or eliminates. Assigns any missing defaults first. Entries whose games are not final are left untouched."
      />
    </>
  );
}
