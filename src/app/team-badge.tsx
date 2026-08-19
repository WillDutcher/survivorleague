/**
 * Team identity display (D31).
 *
 * Two modes, chosen per season:
 *   colors — a chip in the team's primary colour. No trademark exposure.
 *   logos  — the provider's hotlinked logo, opt-in.
 *
 * Three rules hold in BOTH modes, from the accessibility requirements:
 *
 *   1. The team is ALWAYS identified in text. The logo or colour chip is
 *      decoration, marked aria-hidden, and never the only way to tell teams
 *      apart. A screen reader user, a colour-blind user, and someone whose
 *      images failed to load all get the same information.
 *   2. Nothing conveys state by colour alone.
 *   3. A broken image degrades to the colour chip rather than an empty box —
 *      the logos are hotlinked from an unofficial CDN that can vanish.
 */

"use client";

import { useState } from "react";

export interface TeamDisplay {
  id: string;
  city: string;
  name: string;
  colorPrimary: string;
  colorSecondary: string;
  logoUrl: string | null;
}

export function TeamBadge({
  team,
  showLogo,
  size = 28,
  showFullName = false,
}: {
  team: TeamDisplay;
  showLogo: boolean;
  size?: number;
  showFullName?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const useLogo = showLogo && team.logoUrl && !imageFailed;

  return (
    <span className="team-badge">
      {useLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked, never mirrored (D31)
        <img
          src={team.logoUrl as string}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          className="team-logo"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span
          className="team-chip"
          aria-hidden="true"
          style={{
            background: team.colorPrimary,
            borderColor: team.colorSecondary,
            width: size,
            height: size,
          }}
        />
      )}
      <span className="team-name">
        {showFullName ? `${team.city} ${team.name}` : team.id}
      </span>
    </span>
  );
}
