"use client";

import { useActionState } from "react";
import { confirmRebuy, type FormState } from "@/app/actions";

export function RebuyRow({
  rebuyId,
  name,
  lossWeek,
  price,
}: {
  rebuyId: string;
  name: string;
  lossWeek: number;
  price: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(confirmRebuy, {});

  return (
    <tr>
      <td>{name}</td>
      <td>Week {lossWeek}</td>
      <td>
        <strong>{price}</strong>
      </td>
      <td>
        <form action={action} className="inline-form">
          <input type="hidden" name="rebuyId" value={rebuyId} />
          <label className="sr-only" htmlFor={`rref-${rebuyId}`}>
            Payment reference for {name}
          </label>
          <input id={`rref-${rebuyId}`} name="reference" placeholder="PayPal ref" size={14} />
          <button type="submit" disabled={pending} className="primary">
            {pending ? "Saving…" : "Confirm rebuy"}
          </button>
        </form>
        {state.error ? <p role="alert" className="status-bad hint"> {state.error}</p> : null}
      </td>
    </tr>
  );
}
