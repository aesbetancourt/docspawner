// Outbound port: what the worker needs to know the current time.
// The render service calls it. The system clock adapter implements it.
// Tests give a fixed clock, so the timestamp and the duration are predictable.

/** A source of the current time. */
export interface Clock {
  /**
   * Get the current time.
   * @returns The current time.
   */
  now(): Date;
}
