"use client";

import { useActionState } from "react";
import { runSync, toggleTeamLogos, type FormState } from "@/app/actions";

export function LogoToggle({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(toggleTeamLogos, {});

  return (
    <form action={action}>
      <input type="hidden" name="enable" value={String(!enabled)} />
      <p>
        Currently showing <strong>{enabled ? "team logos" : "team colours"}</strong>.
      </p>
      <button type="submit" disabled={pending} className="secondary">
        {pending ? "Switching…" : enabled ? "Switch to colours" : "Switch to logos"}
      </button>
      {state.error ? <p role="alert" className="status-bad hint"> {state.error}</p> : null}
      {state.ok ? <p className="status-ok hint"> {state.ok}</p> : null}
    </form>
  );
}

export function SyncControl({ defaultWeek }: { defaultWeek: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(runSync, {});

  return (
    <form action={action} className="inline-form">
      <label htmlFor="weekNumber">Week</label>
      <input id="weekNumber" name="weekNumber" type="number" min={1} max={18} defaultValue={defaultWeek} />
      <button type="submit" disabled={pending} className="primary">
        {pending ? "Syncing…" : "Sync schedule, scores and lines"}
      </button>
      {state.error ? <p role="alert" className="status-bad hint"> {state.error}</p> : null}
      {state.ok ? <p className="status-ok hint"> {state.ok}</p> : null}
    </form>
  );
}
