import { describe, expect, it } from "effect-bun-test";
import { Effect } from "effect";
import { array, assert, asyncProperty, integer } from "fast-check";
import { StackService } from "../../src/services/Stack.js";

const pick = <A>(values: readonly A[], selector: number): A | undefined =>
  values.length === 0 ? undefined : values[Math.abs(selector) % values.length];

const assertTopology = Effect.fn("Stack.property.assertTopology")(function* () {
  const stacks = yield* StackService;
  const data = yield* stacks.load();
  const projected = yield* stacks.listStacks();
  const projectedBranches = projected.flatMap(({ stack }) => stack.branches);
  const recordBranches = Object.keys(data.branches);
  const expectedStacks = Object.fromEntries(
    projected.map(({ name, stack }) => [name, { root: stack.root }]),
  );
  const expectedBranches = Object.fromEntries(
    projected.flatMap(({ name, stack }) =>
      stack.branches.map((branch, index) => [
        branch,
        { stack: name, parent: index === 0 ? null : (stack.branches[index - 1] ?? null) },
      ]),
    ),
  );
  const actualBranches = Object.fromEntries(
    Object.entries(data.branches).map(([branch, record]) => [
      branch,
      { stack: record.stack, parent: record.parent },
    ]),
  );

  expect(new Set(projectedBranches).size).toBe(projectedBranches.length);
  expect([...projectedBranches].sort()).toEqual([...recordBranches].sort());
  expect(projected.every(({ stack }) => stack.branches[0] === stack.root)).toBe(true);
  expect(data.stacks).toEqual(expectedStacks);
  expect(actualBranches).toEqual(expectedBranches);
});

const markCurrentTopology = Effect.fn("Stack.property.markCurrentTopology")(function* (
  step: number,
) {
  const stacks = yield* StackService;
  const data = yield* stacks.load();
  yield* stacks.save({
    ...data,
    branches: Object.fromEntries(
      Object.entries(data.branches).map(([branch, record]) => [
        branch,
        { ...record, syncedOnto: `marker-${step}-${branch}` },
      ]),
    ),
  });
  return yield* stacks.load();
});

const assertMarkerInvalidation = Effect.fn("Stack.property.assertMarkerInvalidation")(function* (
  before: Readonly<
    Record<
      string,
      { readonly parent: string | null; readonly syncedOnto?: string | null | undefined }
    >
  >,
) {
  const stacks = yield* StackService;
  const after = yield* stacks.load();
  const actual = Object.fromEntries(
    Object.entries(after.branches).map(([branch, record]) => [branch, record.syncedOnto ?? null]),
  );
  const expected = Object.fromEntries(
    Object.entries(after.branches).map(([branch, record]) => {
      const previous = before[branch];
      return [
        branch,
        previous !== undefined && previous.parent === record.parent
          ? (previous.syncedOnto ?? null)
          : null,
      ];
    }),
  );
  expect(actual).toEqual(expected);
});

const runSequence = (selectors: readonly number[]) =>
  Effect.gen(function* () {
    const stacks = yield* StackService;
    let nextBranch = 0;
    const completed = { create: 0, split: 0, reorder: 0, reparent: 0 };

    for (let step = 0; step < selectors.length; step++) {
      const selector = selectors[step] ?? 0;
      const before = yield* markCurrentTopology(step);
      let mutated = false;

      switch (step % 4) {
        case 0: {
          const count = 1 + (Math.abs(selector) % 3);
          const branches = Array.from({ length: count }, () => `branch-${nextBranch++}`);
          const root = branches[0];
          if (root !== undefined) {
            yield* stacks.createStack(root, branches);
            completed.create++;
            mutated = true;
          }
          break;
        }
        case 1: {
          const data = yield* stacks.load();
          const candidates = (yield* stacks.listStacks()).flatMap(({ stack }) =>
            stack.branches.slice(1).filter((branch) => data.stacks[branch] === undefined),
          );
          const branch = pick(candidates, selector);
          if (branch !== undefined) {
            yield* stacks.splitStack(branch);
            completed.split++;
            mutated = true;
          }
          break;
        }
        case 2: {
          const candidates = (yield* stacks.listStacks()).filter(
            ({ stack }) => stack.branches.length > 1,
          );
          const candidate = pick(candidates, selector);
          if (candidate !== undefined) {
            const branch = pick(candidate.stack.branches, selector >>> 3);
            const targets = candidate.stack.branches.filter((name) => name !== branch);
            const target = pick(targets, selector >>> 7);
            if (branch !== undefined && target !== undefined) {
              yield* stacks.reorderBranch(
                branch,
                selector % 2 === 0 ? { before: target } : { after: target },
              );
              completed.reorder++;
              mutated = true;
            }
          }
          break;
        }
        case 3: {
          const data = yield* stacks.load();
          const projected = yield* stacks.listStacks();
          const source = pick(projected, selector);
          const branch =
            source === undefined ? undefined : pick(source.stack.branches, selector >>> 3);
          if (source !== undefined && branch !== undefined) {
            const sourceIndex = source.stack.branches.indexOf(branch);
            const moved = new Set(source.stack.branches.slice(sourceIndex));
            const currentParent = data.branches[branch]?.parent ?? data.trunk;
            const canMoveToTrunk =
              data.stacks[branch] === undefined || (source.name === branch && sourceIndex === 0);
            const targets = [
              ...(canMoveToTrunk ? [data.trunk] : []),
              ...projected
                .flatMap(({ stack }) => stack.branches)
                .filter((name) => !moved.has(name)),
            ].filter((name) => name !== currentParent);
            const target = pick(targets, selector >>> 7);
            if (target !== undefined) {
              yield* stacks.reparentBranch(branch, target);
              completed.reparent++;
              mutated = true;
            }
          }
          break;
        }
      }

      if (mutated) yield* assertMarkerInvalidation(before.branches);
      yield* assertTopology();
    }

    expect(completed.create).toBeGreaterThan(0);
    expect(completed.split).toBeGreaterThan(0);
    expect(completed.reorder).toBeGreaterThan(0);
    expect(completed.reparent).toBeGreaterThan(0);
  }).pipe(Effect.provide(StackService.layerTest()));

describe("StackService topology properties", () => {
  it.effect("preserves topology and sync-marker invariants across long mixed sequences", () =>
    Effect.promise(() =>
      assert(
        asyncProperty(array(integer(), { minLength: 160, maxLength: 240 }), (selectors) =>
          Effect.runPromise(runSequence(selectors)),
        ),
        { numRuns: 20 },
      ),
    ),
  );
});
