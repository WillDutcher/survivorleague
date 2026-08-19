"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUp, type FormState } from "@/app/actions";

interface TierOption {
  id: string;
  label: string;
  price: string;
  detail: string;
}

export function SignUpForm({
  token,
  states,
  termsVersion,
  isPractice,
  tiers,
}: {
  token: string;
  states: ReadonlyArray<{ code: string; name: string }>;
  termsVersion: string;
  isPractice: boolean;
  tiers: TierOption[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(signUp, {});

  return (
    <form action={action} className="card">
      <input type="hidden" name="token" value={token} />

      {state.error ? (
        <p role="alert" className="status-bad" style={{ marginTop: 0 }}>
          {" "}
          {state.error}
        </p>
      ) : null}

      <div className="field-row">
        <div className="field">
          <label htmlFor="firstName">First name</label>
          <input id="firstName" name="firstName" required autoComplete="given-name" />
        </div>
        <div className="field">
          <label htmlFor="lastName">Last name</label>
          <input id="lastName" name="lastName" required autoComplete="family-name" />
        </div>
      </div>
      <p className="muted hint">The league uses real names, not usernames.</p>

      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
        <p className="muted hint">This is how you sign in, and where reminders go.</p>
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          aria-describedby="password-hint"
        />
        <p className="muted hint" id="password-hint">
          At least 10 characters. Length matters more than symbols.
        </p>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="dateOfBirth">Date of birth</label>
          <input id="dateOfBirth" name="dateOfBirth" type="date" required />
          <p className="muted hint">You must be 18 or older to take part.</p>
        </div>
        <div className="field">
          <label htmlFor="state">State of residence</label>
          <select id="state" name="state" required defaultValue="">
            <option value="" disabled>
              Select…
            </option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="field">
        <legend>Entry option</legend>
        {tiers.map((tier, index) => (
          <label key={tier.id} className="tier-option">
            <input type="radio" name="tier" value={tier.id} required defaultChecked={index === 0} />
            <span>
              <strong>
                {tier.label} — {tier.price}
              </strong>
              <span className="muted hint">{tier.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="checkbox-row">
        <input type="checkbox" name="terms" required />
        <span>
          I am 18 or older and accept the{" "}
          <Link href="/rules" target="_blank">
            rules and terms
          </Link>{" "}
          (version {termsVersion}).
        </span>
      </label>

      <button type="submit" disabled={pending} className="primary">
        {pending ? "Creating your account…" : "Create account"}
      </button>

      {!isPractice ? (
        <p className="muted hint">
          After this you will see payment instructions. You are not in the pool until the
          commissioner confirms your entry payment.
        </p>
      ) : null}
    </form>
  );
}
