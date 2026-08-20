"use client";

import { useActionState, useState } from "react";
import { overridePickAction, type FormState } from "@/app/actions";

export interface OverrideEntry {
  entryId: string;
  name: string;
  requiredPicks: number;
  currentPicks: Array<{ slot: number; teamId: string; source: string }>;
}

export interface OverrideGame {
  id: string;
  awayTeamId: string;
  homeTeamId: string;
  kickoff: string;
  kickedOff: boolean;
}

/**
 * Correct one player's pick.
 *
 * Kept behind a collapsed <details> and worded as an exception on purpose. This
 * is the only place a human edits league state by hand, and the real use case is
 * narrow: someone emails at 12:56 saying their computer froze. Making it a
 * prominent button would invite using it for things the rules should decide.
 *
 * The reason field is required by the server, not just here — it is what makes
 * the audit entry mean something when it is read back months later.
 */
export function PickOverride({
  entries,
  games,
  weekNumber,
  weekLabel,
}: {
  entries: OverrideEntry[];
  games: OverrideGame[];
  weekNumber: number;
  weekLabel: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(overridePickAction, {});
  const [entryId, setEntryId] = useState("");
  const [gameId, setGameId] = useState("");

  const entry = entries.find((e) => e.entryId === entryId);
  const game = games.find((g) => g.id === gameId);

  return (
    <details className="card">
      <summary>
        <strong>Override a pick</strong>{" "}
        <span className="muted">— exception handling for {weekLabel}</span>
      </summary>

      <p className="muted hint">
        For the 12:56 email that says the computer froze. Allowed until the week is graded,
        including after kickoff. Every change is written to the audit log with your reason, and
        the pick is marked as yours rather than the player&apos;s. The no-reuse rule still
        applies — it is a database constraint and nothing overrides it.
      </p>

      {games.length === 0 ? (
        <p className="status-bad"> No games loaded for {weekLabel}.</p>
      ) : (
        <form action={action} className="override-form">
          <input type="hidden" name="weekNumber" value={weekNumber} />

          <div className="field">
            <label htmlFor="ov-entry">Player</label>
            <select
              id="ov-entry"
              name="entryId"
              value={entryId}
              onChange={(e) => setEntryId(e.target.value)}
              required
            >
              <option value="">Choose a player…</option>
              {entries.map((e) => (
                <option key={e.entryId} value={e.entryId}>
                  {e.name}
                  {e.currentPicks.length > 0
                    ? ` — has ${e.currentPicks.map((p) => p.teamId).join(", ")}`
                    : " — no pick yet"}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="ov-game">Game</label>
            <select
              id="ov-game"
              name="gameId"
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              required
            >
              <option value="">Choose a game…</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.awayTeamId} at {g.homeTeamId} — {g.kickoff}
                  {g.kickedOff ? " (started)" : ""}
                </option>
              ))}
            </select>
          </div>

          {game ? (
            <fieldset>
              <legend>Team</legend>
              {[game.awayTeamId, game.homeTeamId].map((t) => (
                <label key={t} className="checkbox-row">
                  <input type="radio" name="teamId" value={t} required />
                  <span>{t}</span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {/* Only shown when it can matter: after a tie an entry owes several picks
              and the commissioner has to say which one they are replacing. */}
          {entry && entry.requiredPicks > 1 ? (
            <div className="field">
              <label htmlFor="ov-slot">
                Which pick? This entry owes {entry.requiredPicks} this week
              </label>
              <select id="ov-slot" name="slot" defaultValue="1">
                {Array.from({ length: entry.requiredPicks }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Pick {n}
                    {entry.currentPicks.find((p) => p.slot === n)
                      ? ` (currently ${entry.currentPicks.find((p) => p.slot === n)!.teamId})`
                      : " (empty)"}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <input type="hidden" name="slot" value="1" />
          )}

          <div className="field">
            <label htmlFor="ov-reason">Reason (required, goes in the audit log)</label>
            <input
              id="ov-reason"
              name="reason"
              type="text"
              required
              minLength={3}
              placeholder="e.g. emailed at 12:56, browser crashed mid-submit"
            />
          </div>

          <button type="submit" className="secondary" disabled={pending}>
            {pending ? "Saving…" : "Override pick"}
          </button>

          {state.ok ? (
            <p role="status" className="status-ok">
              {" "}
              {state.ok}
            </p>
          ) : null}
          {state.error ? (
            <p role="alert" className="status-bad">
              {" "}
              {state.error}
            </p>
          ) : null}
        </form>
      )}
    </details>
  );
}
