"use client";

import { useActionState, useState } from "react";
import { issueInvite, type FormState } from "@/app/actions";

export function InviteButton() {
  const [state, action, pending] = useActionState<FormState, FormData>(issueInvite, {});
  const [copied, setCopied] = useState(false);
  const [uses, setUses] = useState(1);

  const url = state.ok ? `${window.location.origin}/join/${state.ok}` : null;

  return (
    <>
      <form action={action}>
        <div className="field">
          <label htmlFor="note">Who is this for? (optional)</label>
          <input id="note" name="note" placeholder="e.g. Kyle from work" />
        </div>
        <div className="field">
          <label htmlFor="maxUses">How many people can use this link?</label>
          <input
            id="maxUses"
            name="maxUses"
            type="number"
            min={1}
            max={50}
            value={uses}
            onChange={(e) => setUses(Number(e.target.value))}
          />
          <p className="hint muted">
            Leave at 1 for one person. Raise it to share a single link with a group — a group
            chat, say. It stops working once that many people have joined, so a link that leaks
            later cannot open the league to strangers.
          </p>
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
            Link created.{" "}
            {uses === 1 ? "Single use — send it to one person." : `Good for ${uses} people.`}
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
