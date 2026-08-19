"use client";

import { useActionState } from "react";
import { changePassword, type FormState } from "@/app/actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});

  return (
    <form action={action}>
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
        <label htmlFor="currentPassword">Current password</label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>

      <div className="field">
        <label htmlFor="newPassword">New password</label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          aria-describedby="new-password-hint"
        />
        <p className="muted hint" id="new-password-hint">
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
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
