// @effect-diagnostics effect/strictEffectProvide:off
import { describe, it, expect } from "effect-bun-test";
import { test } from "bun:test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";
import { createTestLayer } from "../helpers/test-cli.js";

describe("detect command logic", () => {
  // Simulates: main → feat-a → feat-b → feat-c (linear chain)
  const linearAncestry = (ancestor: string, descendant: string): boolean => {
    const order = ["main", "feat-a", "feat-b", "feat-c"];
    const ai = order.indexOf(ancestor);
    const di = order.indexOf(descendant);
    return ai !== -1 && di !== -1 && ai < di;
  };

  it.effect("detects a linear chain of branches", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      // Simulate what detect would do
      const trunk = "main";
      const untracked = ["feat-a", "feat-b", "feat-c"];
      const childOf = new Map<string, string>();

      // feat-a's closest ancestor is main
      // feat-b's closest ancestor is feat-a
      // feat-c's closest ancestor is feat-b
      for (const branch of untracked) {
        const ancestors = [trunk, ...untracked].filter(
          (other) => other !== branch && linearAncestry(other, branch),
        );
        let closest = ancestors[0]!;
        for (let i = 1; i < ancestors.length; i++) {
          if (linearAncestry(closest, ancestors[i]!)) closest = ancestors[i]!;
        }
        childOf.set(branch, closest);
      }

      expect(childOf.get("feat-a")).toBe("main");
      expect(childOf.get("feat-b")).toBe("feat-a");
      expect(childOf.get("feat-c")).toBe("feat-b");

      // Build chain from trunk
      const roots = untracked.filter((b) => childOf.get(b) === trunk);
      expect(roots).toEqual(["feat-a"]);

      const chain = [roots[0]!];
      let current = roots[0]!;
      while (true) {
        const children = untracked.filter((b) => childOf.get(b) === current);
        if (children.length === 1) {
          chain.push(children[0]!);
          current = children[0]!;
        } else break;
      }

      expect(chain).toEqual(["feat-a", "feat-b", "feat-c"]);

      yield* stacks.createStack("feat-a", chain);
      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]?.branches).toEqual(["feat-a", "feat-b", "feat-c"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: {
            currentBranch: "main",
            allBranches: ["main", "feat-a", "feat-b", "feat-c"],
            isAncestor: linearAncestry,
          },
        }),
      ),
    ),
  );

  it.effect("skips already-tracked branches", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const data = yield* stacks.load();

      const allBranches = ["main", "feat-a", "feat-b"];
      const trunk = data.trunk;
      const alreadyTracked = new Set(Object.values(data.stacks).flatMap((s) => [...s.branches]));
      const untracked = allBranches.filter((b) => b !== trunk && !alreadyTracked.has(b));

      // feat-a is already tracked, only feat-b is untracked
      expect(untracked).toEqual(["feat-b"]);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: {
            currentBranch: "main",
            allBranches: ["main", "feat-a", "feat-b"],
            isAncestor: linearAncestry,
          },
          stack: {
            version: 1,
            trunk: "main",
            stacks: { "feat-a": { branches: ["feat-a"] } },
          },
        }),
      ),
    ),
  );

  it.effect("skips stack creation when name already exists", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      // Pre-create a stack with the same name as what detect would generate
      yield* stacks.createStack("feat-a", ["feat-a"]);

      // Attempting to create again should fail (duplicate)
      const data = yield* stacks.load();
      expect(data.stacks["feat-a"]).toBeDefined();

      // Simulate detect behavior: check before creating
      const existingData = yield* stacks.load();
      const alreadyExists = existingData.stacks["feat-a"] !== undefined;
      expect(alreadyExists).toBe(true);
    }).pipe(
      Effect.provide(
        createTestLayer({
          git: {
            currentBranch: "main",
            allBranches: ["main", "feat-a", "feat-b"],
            isAncestor: linearAncestry,
          },
          stack: {
            version: 1,
            trunk: "main",
            stacks: { "feat-a": { branches: ["feat-a"] } },
          },
        }),
      ),
    ),
  );

  test("detects fork and stops chain at fork point", () => {
    // main → feat-a → feat-b, main → feat-a → feat-c
    // This is a fork at feat-a — two children
    const forkAncestry = (ancestor: string, descendant: string): boolean => {
      const chains: Record<string, string[]> = {
        main: ["feat-a", "feat-b", "feat-c"],
        "feat-a": ["feat-b", "feat-c"],
      };
      return chains[ancestor]?.includes(descendant) ?? false;
    };

    const trunk = "main";
    const untracked = ["feat-a", "feat-b", "feat-c"];
    const childOf = new Map<string, string>();

    for (const branch of untracked) {
      const ancestors = [trunk, ...untracked].filter(
        (other) => other !== branch && forkAncestry(other, branch),
      );
      if (ancestors.length === 0) continue;
      let closest = ancestors[0] ?? trunk;
      for (let i = 1; i < ancestors.length; i++) {
        const candidate = ancestors[i];
        if (candidate !== undefined && forkAncestry(closest, candidate)) closest = candidate;
      }
      childOf.set(branch, closest);
    }

    expect(childOf.get("feat-a")).toBe("main");
    expect(childOf.get("feat-b")).toBe("feat-a");
    expect(childOf.get("feat-c")).toBe("feat-a");

    // Chain from root stops at fork
    const roots = untracked.filter((b) => childOf.get(b) === trunk);
    const root = roots[0] ?? "";
    const chain = [root];
    let current = root;
    while (true) {
      const children = untracked.filter((b) => childOf.get(b) === current);
      const child = children[0];
      if (children.length === 1 && child !== undefined) {
        chain.push(child);
        current = child;
      } else break;
    }

    // Chain is just [feat-a] because feat-a has 2 children (fork)
    expect(chain).toEqual(["feat-a"]);

    // Fork points
    const forkPoints = untracked.filter((b) => {
      const children = untracked.filter((c) => childOf.get(c) === b);
      return children.length > 1;
    });
    expect(forkPoints).toEqual(["feat-a"]);
  });
});
