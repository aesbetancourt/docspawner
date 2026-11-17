// Outbound port: what the worker needs to know the current time.
// The render service calls it. The system clock adapter implements it.
export interface Clock {
  now(): Date;
}
