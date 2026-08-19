"use client";

import { signOut } from "@/app/actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button type="submit" className="secondary">
        Sign out
      </button>
    </form>
  );
}
