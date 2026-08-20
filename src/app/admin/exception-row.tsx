"use client";

import { useActionState } from "react";
import { resolveExceptionAction, resolveKindAction, type FormState } from "@/app/actions";

/**
 * Resolve one exception.
 *
 * The note is optional but prompted. "Resolved" with no note is a claim that
 * someone looked, which is worth recording on its own; a note is what makes it
 * useful when the same problem comes back in November.
 */
export function ResolveOne({ exceptionId }: { exceptionId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    resolveExceptionAction,
    {},
  );

  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="exceptionId" value={exceptionId} />
      <input
        type="text"
        name="note"
        placeholder="What you did (optional)"
        aria-label="Resolution note"
        size={22}
      />
      <button type="submit" className="secondary small" disabled={pending}>
        {pending ? "Saving…" : "Resolve"}
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
 * Resolve every open exception of one kind.
 *
 * The realistic case is a re-sync that fixes thirty rows at once. Without this
 * the screen is tedious enough that it stops being used, which is worse than
 * having no screen.
 */
export function ResolveKind({ kind, count }: { kind: string; count: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resolveKindAction, {});

  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="kind" value={kind} />
      <input
        type="text"
        name="note"
        placeholder="Reason for clearing all"
        aria-label="Bulk resolution note"
        size={22}
      />
      <button type="submit" className="secondary small" disabled={pending}>
        {pending ? "Saving…" : `Resolve all ${count}`}
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
