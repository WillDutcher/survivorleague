import Link from "next/link";
import { consumeVerification } from "@/lib/verification";

export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await consumeVerification(token);

  return (
    <>
      <h1>Email confirmation</h1>
      <div className="card">
        {result.ok ? (
          <>
            <p className="status-ok"> Your email is confirmed.</p>
            <p className="muted">
              The league can now reach you with weekly reminders and deadlines.
            </p>
          </>
        ) : (
          <>
            <p className="status-bad"> {result.message}</p>
            <p className="muted">
              Sign in and use the resend button on your dashboard to get a fresh link.
            </p>
          </>
        )}
        <p>
          <Link href="/dashboard">Go to your dashboard</Link>
        </p>
      </div>
    </>
  );
}
