"use client";

import { useActionState } from "react";
import { choosePick, type FormState } from "@/app/actions";
import { TeamBadge, type TeamDisplay } from "@/app/team-badge";

/**
 * One selectable team.
 *
 * A team that cannot be picked is rendered as a DISABLED BUTTON, not as plain
 * text: it stays in the tab order, keeps its accessible name, and carries a
 * reason a screen reader will announce. The brief is explicit that a previously
 * used team must not look selectable and that an illegal selection must explain
 * itself — so the explanation is always visible, never a hover tooltip.
 *
 * State is never carried by colour alone: selected teams are marked with a
 * checkmark and the word "Your pick", and unavailable ones state their reason.
 */
export function PickButton({
  team,
  weekNumber,
  showLogo,
  selected,
  disabled,
  reason,
  locked,
}: {
  team: TeamDisplay;
  weekNumber: number;
  showLogo: boolean;
  selected: boolean;
  disabled: boolean;
  reason: string | null;
  locked: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(choosePick, {});

  const className = [
    "pick-button",
    selected ? "is-selected" : "",
    disabled ? "is-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <form action={action} className="pick-form">
      <input type="hidden" name="teamId" value={team.id} />
      <input type="hidden" name="weekNumber" value={weekNumber} />

      <button
        type="submit"
        className={className}
        disabled={disabled || pending}
        aria-pressed={selected}
        aria-describedby={reason ? `reason-${team.id}-${weekNumber}` : undefined}
        style={
          selected
            ? { borderColor: team.colorPrimary, boxShadow: `inset 0 0 0 2px ${team.colorPrimary}` }
            : undefined
        }
      >
        <TeamBadge team={team} showLogo={showLogo} showFullName size={26} />
        <span className="pick-state">
          {pending
            ? "Saving…"
            : selected
              ? locked
                ? "✓ Your pick — locked"
                : "✓ Your pick — tap to remove"
              : disabled
                ? "Unavailable"
                : "Pick"}
        </span>
      </button>

      {reason ? (
        <span className="pick-reason" id={`reason-${team.id}-${weekNumber}`}>
          {reason}
        </span>
      ) : null}

      {state.error ? (
        <span role="alert" className="pick-error status-bad">
          {" "}
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
