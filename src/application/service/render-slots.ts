// A bounded render queue (ADR-0011): a fixed number of renders run, a fixed number wait, the rest get "busy".
// It protects the CPU, because each render starts one Typst process.
import type { RenderLoad } from "../../domain/render.js";

/** The two limits of the render queue. */
export interface RenderSlotsOptions {
  /** Renders that run at the same time. Match it to the CPUs of the worker. */
  maxConcurrent: number;
  /** Renders that wait for a free slot. When the queue is full, `run` returns "busy" at once. */
  maxQueued: number;
}

/** Every way a slot request can end. */
export const SLOT_RESULT = {
  done: "done",
  busy: "busy",
} as const;

/** The task's value when it ran, or "busy" when it did not run. */
export type SlotResult<T> = { kind: typeof SLOT_RESULT.done; value: T } | { kind: typeof SLOT_RESULT.busy };

/**
 * Limits how many renders run at once. Other renders wait in a first-in, first-out queue.
 * A task starts only when it has a slot, so its timeout does not include the wait.
 */
export class RenderSlots {
  private readonly options: RenderSlotsOptions;
  /** Tasks that hold a slot now. */
  private active = 0;
  /** One wake-up function per waiting task, oldest first. */
  private readonly waiting: (() => void)[] = [];

  /**
   * Create the render queue.
   * @param options - How many renders run at once, and how many can wait.
   * @throws Error when a limit is not a whole number in range.
   */
  constructor(options: RenderSlotsOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new Error("maxConcurrent must be an integer of 1 or more");
    }
    if (!Number.isInteger(options.maxQueued) || options.maxQueued < 0) {
      throw new Error("maxQueued must be an integer of 0 or more");
    }
    this.options = options;
  }

  /**
   * Run `task` when a slot is free.
   * @param task - The work to run in the slot.
   * @returns The task's value, or "busy" at once when every slot is taken and the queue is full.
   * @throws Whatever `task` throws. The slot is freed first.
   */
  async run<T>(task: () => Promise<T>): Promise<SlotResult<T>> {
    if (this.active < this.options.maxConcurrent) {
      this.active++;
    } else if (this.waiting.length < this.options.maxQueued) {
      // The task that finishes hands its slot to this one, so `active` does not change.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      return { kind: SLOT_RESULT.busy };
    }

    try {
      return { kind: SLOT_RESULT.done, value: await task() };
    } finally {
      this.release();
    }
  }

  /**
   * Report the current load, for `/health` and for the logs.
   * @returns How many renders run now, how many wait, and the limits.
   */
  load(): RenderLoad {
    return { ...this.options, active: this.active, queued: this.waiting.length };
  }

  /** Hand the slot to the next waiting task, or free it when no task waits. */
  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.active--;
  }
}
