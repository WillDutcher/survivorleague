"use client";

import { useActionState } from "react";
import { proposeSplit, voteOnSplit, type FormState } from "@/app/actions";

export function VoteButtons({ proposalId }: { proposalId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(voteOnSplit, {});

  return (
    <>
      {state.error ? (
        <p role="alert" className="status-bad">
          {" "}
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="status-ok">
          {" "}
          {state.ok}
        </p>
      ) : null}
      <div className="button-row">
        <form action={action}>
          <input type="hidden" name="proposalId" value={proposalId} />
          <input type="hidden" name="response" value="yes" />
          <button type="submit" disabled={pending} className="primary">
            {pending ? "Saving…" : "I agree to this split"}
          </button>
        </form>
        <form action={action}>
          <input type="hidden" name="proposalId" value={proposalId} />
          <input type="hidden" name="response" value="no" />
          <button type="submit" disabled={pending} className="secondary">
            No — keep playing
          </button>
        </form>
      </div>
    </>
  );
}

export function ProposeForm({
  survivors,
  potLabel,
}: {
  survivors: Array<{ entryId: string; name: string; suggested: string }>;
  potLabel: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(proposeSplit, {});

  return (
    <form action={action}>
      {state.error ? (
        <p role="alert" className="status-bad">
          {" "}
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="status-ok">
          {" "}
          {state.ok}
        </p>
      ) : null}

      <div className="alloc-grid">
        {survivors.map((s) => (
          <div className="alloc-row" key={s.entryId}>
            <label htmlFor={`amount-${s.entryId}`}>{s.name}</label>
            <input
              id={`amount-${s.entryId}`}
              name={`amount-${s.entryId}`}
              type="number"
              step="0.01"
              min="0"
              defaultValue={s.suggested}
              required
            />
          </div>
        ))}
      </div>

      <div className="field">
        <label htmlFor="note">Why these numbers? (optional)</label>
        <input
          id="note"
          name="note"
          placeholder="e.g. Dave gets $20 each from us to stop playing"
        />
      </div>

      <p className="muted hint">Must total exactly {potLabel}.</p>

      <button type="submit" disabled={pending} className="primary">
        {pending ? "Opening…" : "Open this proposal"}
      </button>
    </form>
  );
}
