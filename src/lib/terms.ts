/**
 * Terms of participation.
 *
 * Versioned deliberately (D7): every user records which version they accepted
 * and when, so if the terms change mid-season it is provable what each person
 * agreed to. Bump TERMS_VERSION whenever the text changes materially.
 *
 * NOT LEGAL ADVICE. This is a starting point for the commissioner to edit, and
 * DECISIONS.md D21 records the Virginia research behind it: the pool's posture
 * rests on the organizer taking no rake and the pool being private and
 * invite-only. Both of those must stay true in fact, not just on this page.
 */

export const TERMS_VERSION = "2026.1";

export interface TermsSection {
  heading: string;
  body: string[];
}

export const TERMS: TermsSection[] = [
  {
    heading: "What this is",
    body: [
      "This is a private NFL survivor pool among people who know each other. It is not a public contest, not a sportsbook, and not a commercial service. Participation is by invitation only.",
    ],
  },
  {
    heading: "You must be 18 or older",
    body: [
      "You must be at least 18 years old to participate. You confirm your date of birth at signup, and it is recorded. Anyone found to be under 18 will be removed and refunded in full.",
    ],
  },
  {
    heading: "The organizer takes nothing",
    body: [
      "Every dollar collected is paid back out to participants. The commissioner takes no fee, no rake, and no share of the pot for running the pool. Payout amounts are calculated to the cent and always total exactly what was collected.",
      "Entry money passes through the commissioner's personal account for convenience only. It is not his money and is never treated as income of the pool.",
    ],
  },
  {
    heading: "The app enforces the rules",
    body: [
      "The published rules are generated from the same configuration this application executes, so what you read is what is enforced. Deadlines, team reuse, rebuy eligibility, and results processing are all applied by the server automatically and identically for everyone.",
      "Where the application and a person disagree, the application's record is the starting point. The commissioner can correct genuine errors, and every correction is logged with who made it, when, and why.",
    ],
  },
  {
    heading: "Deadlines are final",
    body: [
      "Picks lock at the times shown in the app. If you miss a deadline, a default pick is assigned automatically using a published, deterministic rule. A missed pick is not a reason to reverse a result.",
    ],
  },
  {
    heading: "Payment and eligibility",
    body: [
      "You are not in the pool until your entry payment is confirmed. Until then you can sign in and look around, but you hold no place in the pool and no share of the pot.",
      "Rebuy availability and pricing follow the published rules for your entry option. Rebuys must be paid and confirmed before your entry becomes active again.",
    ],
  },
  {
    heading: "Ending the season early",
    body: [
      "Remaining players may agree to split the pot at any point, but only unanimously. A single objection, or a failure to respond before the next week begins, means play continues. Splits do not have to be equal — any division the remaining players all agree to is valid.",
    ],
  },
  {
    heading: "No warranty",
    body: [
      "This application is run by one person for a group of friends. It may have bugs, and external data sources for schedules, scores, and point spreads may be wrong or unavailable. Errors will be corrected in good faith when found, but no guarantee of uninterrupted or error-free operation is made.",
    ],
  },
  {
    heading: "Your information",
    body: [
      "Your name, email, date of birth, and state of residence are stored to run the pool and are not sold or shared. Other participants can see your name and your picks once picks are locked.",
    ],
  },
];

/** US states, for the residence field recorded at signup (D8). */
export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];
