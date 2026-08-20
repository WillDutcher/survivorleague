"use client";

import { useActionState, useState } from "react";
import {
  lockLines,
  runDefaults,
  runOddsSync,
  runResults,
  sendReminder,
  type FormState,
} from "@/app/actions";

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

  // Controlled, so the chosen week survives the re-render after the action.
  // An uncontrolled input silently snapped back to the season's current week,
  // which made it look like the wrong week had been submitted.
  const [week, setWeek] = useState(String(defaultWeek));

  return (
    <div className="week-control">
      <form action={formAction} className="inline-form">
        <label htmlFor={id}>Week</label>
        <input
          id={id}
          name="weekNumber"
          type="number"
          min={1}
          max={18}
          value={week}
          onChange={(e) => setWeek(e.target.value)}
        />
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

export function OddsSyncControl() {
  const [state, action, pending] = useActionState<FormState, FormData>(runOddsSync, {});

  return (
    <div className="week-control">
      <form action={action}>
        <button type="submit" disabled={pending} className="primary">
          {pending ? "Fetching…" : "Fetch scores and lines"}
        </button>
      </form>
      <p className="muted hint">
        Pulls from The Odds API, which works from the server — ESPN refuses it. Updates scores on
        finished games and captures fresh candidate lines. Scores are only available for the last
        3 days, so a Sunday slate must be fetched by Wednesday.
      </p>
      {state.error ? <p role="alert" className="status-bad hint"> {state.error}</p> : null}
      {state.ok ? <p role="status" className="status-ok hint"> {state.ok}</p> : null}
    </div>
  );
}

export function ReminderControl({ defaultWeek }: { defaultWeek: number }) {
  return (
    <Control
      action={sendReminder}
      label="Send weekly reminder"
      defaultWeek={defaultWeek}
      hint="Emails every active player the slate, the locked lines, and their deadline — and tells anyone owing multiple picks that they do. Sends once per week; a second attempt is refused rather than double-mailing fifty people."
    />
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
