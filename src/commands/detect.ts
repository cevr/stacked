import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Show what would be detected without making changes"),
);

export const detect = Command.make("detect", { dryRun: dryRunFlag }).pipe(
  Command.withDescription("Detect and register branch stacks from git history"),
  Command.withHandler(({ dryRun }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const trunk = yield* stacks.getTrunk();
      const allBranches = yield* git.listBranches();
      const candidates = allBranches.filter((b) => b !== trunk);

      const data = yield* stacks.load();
      const alreadyTracked = new Set(Object.values(data.stacks).flatMap((s) => [...s.branches]));
      const untracked = candidates.filter((b) => !alreadyTracked.has(b));

      if (untracked.length === 0) {
        yield* Console.error("No untracked branches found");
        return;
      }

      // Build parent map: for each branch, find its direct parent among other branches
      // A parent is the closest ancestor — i.e., an ancestor that is not an ancestor of another ancestor
      const childOf = new Map<string, string>();

      yield* Effect.forEach(
        untracked,
        (branch) =>
          Effect.gen(function* () {
            // Check all potential ancestors (trunk + other untracked) in parallel
            const potentialAncestors = [trunk, ...untracked.filter((b) => b !== branch)];
            const ancestryResults = yield* Effect.forEach(
              potentialAncestors,
              (other) =>
                git.isAncestor(other, branch).pipe(
                  Effect.catchTag("GitError", () => Effect.succeed(false)),
                  Effect.map((is) => [other, is] as const),
                ),
              { concurrency: 5 },
            );

            const ancestors = ancestryResults.filter(([_, is]) => is).map(([name]) => name);

            if (ancestors.length === 0) return;

            // Find the closest ancestor — the one that is a descendant of all others
            let closest = ancestors[0] ?? trunk;
            for (let i = 1; i < ancestors.length; i++) {
              const candidate = ancestors[i];
              if (candidate === undefined) continue;
              const candidateIsCloser = yield* git
                .isAncestor(closest, candidate)
                .pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));
              if (candidateIsCloser) closest = candidate;
            }

            childOf.set(branch, closest);
          }),
        { concurrency: 5 },
      );

      // Build linear chains from trunk
      // Find branches whose parent is trunk (chain roots)
      const chains: string[][] = [];
      const roots = untracked.filter((b) => childOf.get(b) === trunk);

      for (const root of roots) {
        const chain = [root];
        let current = root;

        while (true) {
          const children = untracked.filter((b) => childOf.get(b) === current);
          const child = children[0];
          if (children.length === 1 && child !== undefined) {
            chain.push(child);
            current = child;
          } else {
            // 0 children = end of chain, 2+ children = fork (skip)
            break;
          }
        }

        chains.push(chain);
      }

      if (chains.length === 0) {
        yield* Console.error("No linear branch chains detected");
        return;
      }

      for (const chain of chains) {
        const name = chain[0];
        if (name === undefined) continue;
        if (dryRun) {
          yield* Console.error(`Would create stack "${name}": ${chain.join(" → ")}`);
        } else {
          yield* stacks.createStack(name, chain);
          yield* Console.error(`Created stack "${name}": ${chain.join(" → ")}`);
        }
      }

      if (dryRun) {
        yield* Console.error(
          `\n${chains.length} stack${chains.length === 1 ? "" : "s"} would be created`,
        );
      }

      // Report forks
      const forkPoints = untracked.filter((b) => {
        const children = untracked.filter((c) => childOf.get(c) === b);
        return children.length > 1;
      });
      if (forkPoints.length > 0) {
        yield* Console.error("\nNote: forked branches detected (not supported yet):");
        for (const branch of forkPoints) {
          const children = untracked.filter((c) => childOf.get(c) === branch);
          yield* Console.error(`  ${branch} → ${children.join(", ")}`);
        }
      }
    }),
  ),
);
