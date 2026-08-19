"use client";

import { useActionState } from "react";
import { killInvite, type FormState } from "@/app/actions";

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(killInvite, {});

  return (
    <form action={action}>
      <input type="hidden" name="inviteId" value={inviteId} />
      <button type="submit" disabled={pending} className="secondary small">
        {pending ? "…" : "Revoke"}
      </button>
      {state.error ? <span className="status-bad hint"> {state.error}</span> : null}
    </form>
  );
}
