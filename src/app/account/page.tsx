import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <>
      <h1>Your account</h1>
      <p className="muted">
        {user.firstName} {user.lastName} · {user.email}
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Change password</h2>
        <p className="muted">
          Changing your password signs you out everywhere else. This tab stays signed in.
        </p>
        <ChangePasswordForm />
      </div>
    </>
  );
}
