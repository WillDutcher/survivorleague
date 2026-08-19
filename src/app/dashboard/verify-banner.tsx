"use client";

import { useActionState } from "react";
import { resendVerification, type FormState } from "@/app/actions";

export function VerifyBanner({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resendVerification, {});

  return (
    <div className="card">
      <p style={{ marginTop: 0 }}>
        <strong>Confirm your email.</strong> We sent a link to <code>{email}</code>. Until you
        confirm it, reminders and deadline warnings may not reach you.
      </p>
      <p className="muted hint">
        This does not stop you playing — your picks count either way.
      </p>
      {state.error ? <p role="alert" className="status-bad"> {state.error}</p> : null}
      {state.ok ? <p role="status" className="status-ok"> {state.ok}</p> : null}
      <form action={action}>
        <button type="submit" disabled={pending} className="secondary">
          {pending ? "Sending…" : "Resend confirmation"}
        </button>
      </form>
    </div>
  );
}
