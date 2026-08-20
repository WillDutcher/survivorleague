/**
 * A compact team marker for dense tables.
 *
 * Distinct from TeamBadge, which is sized for the pick buttons: this is the
 * inline form used where a whole column is nothing but teams, so it has to stay
 * scannable at small size.
 *
 * Two modes, matching the season's display flag (D31):
 *   logos  — the provider's logo followed by the abbreviation
 *   colors — the abbreviation set on the team's primary colour
 *
 * The abbreviation is ALWAYS text, in both modes. The colour and the logo are
 * decoration: a colour-blind reader, a screen reader, and someone whose images
 * failed all read the same thing. Text colour is computed per team rather than
 * fixed, because the primaries run from Bengals orange to Raiders black and one
 * fixed choice is unreadable on half of them.
 */

"use client";

import { useState } from "react";
import { chipBorder, readableTextOn } from "@/lib/colors";
import type { TeamDisplay } from "@/app/team-badge";

export function TeamTag({
  team,
  showLogo,
  size = 18,
}: {
  team: TeamDisplay;
  showLogo: boolean;
  size?: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const useLogo = showLogo && team.logoUrl && !imageFailed;

  if (useLogo) {
    return (
      <span className="team-tag team-tag-logo">
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked, never mirrored (D31) */}
        <img
          src={team.logoUrl as string}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          onError={() => setImageFailed(true)}
        />
        <span>{team.id}</span>
      </span>
    );
  }

  return (
    <span
      className="team-tag team-tag-color"
      style={{
        background: team.colorPrimary,
        color: readableTextOn(team.colorPrimary),
        borderColor: chipBorder(team.colorPrimary, team.colorSecondary),
      }}
      title={`${team.city} ${team.name}`}
    >
      {team.id}
    </span>
  );
}
