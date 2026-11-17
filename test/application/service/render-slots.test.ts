import { describe, expect, it } from "vitest";
import { RenderSlots } from "../../../src/application/service/render-slots.js";

/**
 * Tasks that finish only when the test says so.
 * @returns `task` to start a task, `pending` to finish or fail each started task, and the highest number that ran at once.
 */
function controlledTasks() {
  const pending: { finish: () => void; fail: () => void }[] = [];
  let running = 0;
  let maxRunning = 0;
  const task = () =>
    new Promise<string>((resolve, reject) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      pending.push({
        finish: () => {
          running--;
          resolve("ok");
        },
        fail: () => {
          running--;
          reject(new Error("boom"));
        },
      });
    });
  return { task, pending, maxRunning: () => maxRunning };
}

/** Wait until pending promise callbacks have run. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Run `step(0)`, then `step(1)`, and so on: each step waits for the one before it.
 * @param count - The number of steps.
 * @param step - The work for one step.
 * @returns A promise that resolves after the last step.
 */
function inSequence(count: number, step: (index: number) => Promise<void>): Promise<void> {
  return Array.from({ length: count }, (_, index) => index).reduce(
    (previous, index) => previous.then(() => step(index)),
    Promise.resolve(),
  );
}
const done = { kind: "done", value: "ok" };

describe("RenderSlots", () => {
  it("runs at most maxConcurrent tasks at once and queues the rest", async () => {
    const tasks = controlledTasks();
    const slots = new RenderSlots({ maxConcurrent: 2, maxQueued: 10 });

    const results = Array.from({ length: 5 }, () => slots.run(tasks.task));
    await tick();
    expect(tasks.pending).toHaveLength(2);
    expect(slots.load()).toMatchObject({ active: 2, queued: 3 });

    // Finish the tasks in order. Each finish lets the next queued task start.
    await inSequence(5, async (i) => {
      tasks.pending[i]?.finish();
      await tick();
    });

    expect(await Promise.all(results)).toEqual(Array.from({ length: 5 }, () => done));
    expect(tasks.maxRunning()).toBe(2);
    expect(slots.load()).toMatchObject({ active: 0, queued: 0 });
  });

  it("returns busy at once when the queue is full", async () => {
    const tasks = controlledTasks();
    const slots = new RenderSlots({ maxConcurrent: 1, maxQueued: 1 });

    const first = slots.run(tasks.task);
    const second = slots.run(tasks.task);
    expect(await slots.run(tasks.task)).toEqual({ kind: "busy" });

    tasks.pending[0]!.finish();
    await tick();
    tasks.pending[1]!.finish();
    expect(await Promise.all([first, second])).toEqual([done, done]);
  });

  it("frees the slot when a task throws", async () => {
    const tasks = controlledTasks();
    const slots = new RenderSlots({ maxConcurrent: 1, maxQueued: 1 });

    const failing = slots.run(tasks.task);
    const queued = slots.run(tasks.task);
    tasks.pending[0]!.fail();
    await expect(failing).rejects.toThrow("boom");
    await tick();

    tasks.pending[1]!.finish();
    expect(await queued).toEqual(done);
    expect(slots.load()).toMatchObject({ active: 0, queued: 0 });
  });
});
