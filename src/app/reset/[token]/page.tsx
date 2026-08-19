import Link from "next/link";
import { resetTokenIsValid } from "@/lib/auth";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await resetTokenIsValid(token);

  if (!valid) {
    return (
      <>
        <h1>Reset link</h1>
        <div className="card">
          <p className="status-bad"> That reset link is invalid, already used, or expired.</p>
          <p>
            <Link href="/forgot">Request a new one</Link>.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Choose a new password</h1>
      <ResetForm token={token} />
    </>
  );
}
