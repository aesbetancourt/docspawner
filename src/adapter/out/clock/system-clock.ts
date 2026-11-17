import type { Clock } from "../../../application/port/out/clock.js";

/** Outbound adapter: implements Clock with the system time. */
export const systemClock: Clock = { now: () => new Date() };
