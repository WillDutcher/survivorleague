"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type FormState } from "@/app/actions";

export default function ForgotPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordReset, {});

  return (
    <>
      <h1>Reset your password</h1>
      <form action={action} className="card">
        {state.error ? (
          <p role="alert" className="status-bad" style={{ marginTop: 0 }}>
            {" "}
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p role="status" className="status-ok" style={{ marginTop: 0 }}>
            {" "}
            {state.ok}
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" autoFocus />
        </div>

        <button type="submit" disabled={pending} className="primary">
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="muted">
        Remembered it? <Link href="/login">Sign in</Link>.
      </p>
    </>
  );
}
