# A fixed number of render slots and a bounded queue

Status: accepted

docspawner is a worker. Without a limit, each request started its own Typst process at once. Under a burst, all processes shared the CPU, each render became many times slower, and healthy templates reached the compile timeout.

Measured on 1 CPU: one heavy render takes about 200 ms. A burst of 80 at once failed 72 of 80 with `408 timeout`. With one render slot and a queue, the same burst completed 80 of 80 in the same total time (about 14 s).

The render service runs each compile through `RenderSlots` (`src/application/service/render-slots.ts`):

- At most `maxConcurrent` compiles run at once (default: the CPU count).
- Other compiles wait in a first-in, first-out queue of `maxQueued` (default 100).
- When the queue is full, the service returns a `busy` error at once. HTTP maps it to `503` with `Retry-After`, so a load balancer or client can retry on another copy.
- The compile timeout starts when the compile starts. Time in the queue does not count against the template.

The first version implemented the `TypstCompiler` port as a decorator, so the port had to return `busy`. A review found that this leaked a queue concept into the port. The slots now belong to the service, and the port only compiles (ADR-0004).

## Considered options

- **No limit, rely on container CPU limits:** the CPU limit slows every render equally, so the timeout failures stay.
- **Rate limit at the gateway:** protects the worker, but the gateway does not know how heavy each render is. It still needs a limit in the worker.
- **A queue service (Redis, SQS) and async jobs:** handles long batches, but adds infrastructure and changes the API from request-response to jobs. Out of scope (ADR-0002).
- **In-process slots and a bounded queue:** **chosen**. No new infrastructure, the API stays synchronous, and overload is explicit (`503`).

## Consequences

- `x-render-duration-ms` includes the time in the queue.
- A request can wait for up to `maxQueued × render time`. Callers must set their HTTP timeout with that in mind.
- The slots live in the service layer. The ports and the Typst adapter did not change (ADR-0004).
