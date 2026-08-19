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
