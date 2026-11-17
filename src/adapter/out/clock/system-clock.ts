import type { Clock } from "../../../application/port/out/clock.js";

/** Outbound adapter: implements Clock with the system time. It is the only place that reads the real clock. */
export const systemClock: Clock = { now: () => new Date() };
