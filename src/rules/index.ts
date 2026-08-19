/**
 * The Survivor League rule engine.
 *
 * Pure domain logic: no database, no network, no framework, no clock reads.
 * Every function takes its inputs explicitly, including `now`.
 *
 * Nothing in this directory may import from outside it. That constraint is what
 * makes every league rule testable without fixtures or a running application,
 * and it is the discipline the previous implementation attempt lacked.
 */

export * from "./types";
export * from "./config";
export * from "./locks";
export * from "./weeks";
export * from "./eligibility";
export * from "./defaults";
export * from "./results";
export * from "./rebuys";
export * from "./settlement";
