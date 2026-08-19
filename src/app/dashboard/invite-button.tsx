"use client";

import { useActionState, useState } from "react";
import { issueInvite, type FormState } from "@/app/actions";

export function InviteButton() {
  const [state, action, pending] = useActionState<FormState, FormData>(issueInvite, {});
  const [copied, setCopied] = useState(false);

  const url = state.ok ? `${window.location.origin}/join/${state.ok}` : null;

  return (
    <>
      <form action={action}>
        <div className="field">
          <label htmlFor="note">Who is this for? (optional)</label>
          <input id="note" name="note" placeholder="e.g. Kyle from work" />
        </div>
        <button type="submit" disabled={pending} className="primary">
          {pending ? "Creating…" : "Create invite link"}
        </button>
      </form>

      {state.error ? (
        <p role="alert" className="status-bad">
          {" "}
          {state.error}
        </p>
      ) : null}

      {url ? (
        <div className="invite-result">
          <p className="status-ok" style={{ marginBottom: "0.5rem" }}>
            {" "}
            Link created. Single use — send it to one person.
          </p>
          <code className="invite-url">{url}</code>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              navigator.clipboard.writeText(url).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}
    </>
  );
}
