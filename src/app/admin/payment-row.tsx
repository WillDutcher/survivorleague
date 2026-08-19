"use client";

import { useActionState } from "react";
import { markEntryPaid, type FormState } from "@/app/actions";

export function PaymentRow({
  entryId,
  name,
  email,
  tierLabel,
  owed,
}: {
  entryId: string;
  name: string;
  email: string;
  tierLabel: string;
  owed: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(markEntryPaid, {});

  return (
    <tr>
      <td>
        {name}
        <div className="muted hint">{email}</div>
      </td>
      <td>{tierLabel}</td>
      <td>
        <strong>{owed}</strong>
      </td>
      <td>
        <form action={action} className="inline-form">
          <input type="hidden" name="entryId" value={entryId} />
          <label className="sr-only" htmlFor={`ref-${entryId}`}>
            Payment reference for {name}
          </label>
          <input
            id={`ref-${entryId}`}
            name="reference"
            placeholder="PayPal ref / note"
            size={16}
          />
          <button type="submit" disabled={pending} className="primary">
            {pending ? "Saving…" : "Mark paid"}
          </button>
        </form>
        {state.error ? (
          <p role="alert" className="status-bad hint">
            {" "}
            {state.error}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
