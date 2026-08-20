/**
 * League contact details.
 *
 * Kept here rather than scattered through templates so there is exactly one
 * place to change when the commissioner or the payment destination changes.
 */

export const LEAGUE = {
  commissionerName: "Will Dutcher",
  /** Where entry and rebuy payments are sent (D30). */
  paypalAddress: "Ramtrap@aol.com",
  /**
   * Friends-and-family avoids goods-and-services fees and keeps the money out
   * of business-income reporting. Stated everywhere payment is requested so the
   * instruction is consistent (D9).
   */
  paypalTransferType: "friends and family",
} as const;

/**
 * Where players write when something is wrong.
 *
 * Read from the same env var the outgoing mail uses for Reply-To, so the
 * address players are told to use and the address their replies actually reach
 * cannot drift apart. Changing one changes both.
 */
export function commissionerEmail(): string {
  return process.env.REPLY_TO || "commissioner@novasurvivorleague.com";
}

/**
 * A mailto with the subject pre-filled.
 *
 * The league name in the subject is not decoration: these land in a personal
 * inbox alongside everything else, and a consistent prefix is what makes them
 * filterable and findable in December.
 */
export function commissionerMailto(subject: string): string {
  return `mailto:${commissionerEmail()}?subject=${encodeURIComponent(`[Survivor League] ${subject}`)}`;
}
