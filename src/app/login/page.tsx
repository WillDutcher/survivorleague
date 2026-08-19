"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn, type FormState } from "@/app/actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});

  return (
    <>
      <h1>Sign in</h1>
      <form action={action} className="card">
        {state.error ? (
          <p role="alert" className="status-bad" style={{ marginTop: 0 }}>
            {" "}
            {state.error}
          </p>
        ) : null}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" autoFocus />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>

        <button type="submit" disabled={pending} className="primary">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="muted">
        <Link href="/forgot">Forgot your password?</Link>
      </p>

      <p className="muted">
        This pool is invite-only. If you do not have an account, ask whoever runs your league
        for an invite link.
      </p>
    </>
  );
}
