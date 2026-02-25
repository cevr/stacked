import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

const dryRunFlag = Flag.boolean("dry-run");

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
        yield* Console.log("No untracked branches found");
        return;
      }

      // Build parent map: for each branch, find its direct parent among other branches
      // A parent is the closest ancestor — i.e., an ancestor that is not an ancestor of another ancestor
      const childOf = new Map<string, string>();

      for (const branch of untracked) {
        const ancestors: string[] = [];

        // Check trunk
        const trunkIsAncestor = yield* git
          .isAncestor(trunk, branch)
          .pipe(Effect.catch(() => Effect.succeed(false)));
        if (trunkIsAncestor) ancestors.push(trunk);

        // Check other untracked branches
        for (const other of untracked) {
          if (other === branch) continue;
          const is = yield* git
            .isAncestor(other, branch)
            .pipe(Effect.catch(() => Effect.succeed(false)));
          if (is) ancestors.push(other);
        }

        if (ancestors.length === 0) continue;

        // Find the closest ancestor — the one that is a descendant of all others
        let closest = ancestors[0] ?? trunk;
        for (let i = 1; i < ancestors.length; i++) {
          const candidate = ancestors[i];
          if (candidate === undefined) continue;
          const candidateIsCloser = yield* git
            .isAncestor(closest, candidate)
            .pipe(Effect.catch(() => Effect.succeed(false)));
          if (candidateIsCloser) closest = candidate;
        }

        childOf.set(branch, closest);
      }

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
        yield* Console.log("No linear branch chains detected");
        return;
      }

      for (const chain of chains) {
        const name = chain[0];
        if (name === undefined) continue;
        if (dryRun) {
          yield* Console.log(`Would create stack "${name}": ${chain.join(" → ")}`);
        } else {
          yield* stacks.createStack(name, chain);
          yield* Console.log(`Created stack "${name}": ${chain.join(" → ")}`);
        }
      }

      if (dryRun) {
        yield* Console.log(
          `\n${chains.length} stack${chains.length === 1 ? "" : "s"} would be created`,
        );
      }

      // Report forks
      const forkPoints = untracked.filter((b) => {
        const children = untracked.filter((c) => childOf.get(c) === b);
        return children.length > 1;
      });
      if (forkPoints.length > 0) {
        yield* Console.log("\nNote: forked branches detected (not supported yet):");
        for (const branch of forkPoints) {
          const children = untracked.filter((c) => childOf.get(c) === branch);
          yield* Console.log(`  ${branch} → ${children.join(", ")}`);
        }
      }
    }),
  ),
);
