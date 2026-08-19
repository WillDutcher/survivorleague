"use client";

import { useActionState } from "react";
import { resetPassword, type FormState } from "@/app/actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPassword, {});

  return (
    <form action={action} className="card">
      <input type="hidden" name="token" value={token} />

      {state.error ? (
        <p role="alert" className="status-bad" style={{ marginTop: 0 }}>
          {" "}
          {state.error}
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="newPassword">New password</label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          autoFocus
          aria-describedby="reset-hint"
        />
        <p className="muted hint" id="reset-hint">
          At least 10 characters. Length matters more than symbols.
        </p>
      </div>

      <div className="field">
        <label htmlFor="confirmPassword">Confirm new password</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
      </div>

      <button type="submit" disabled={pending} className="primary">
        {pending ? "Saving…" : "Set new password"}
      </button>

      <p className="muted hint">
        This signs you out on every device, including any you did not recognise.
      </p>
    </form>
  );
}
