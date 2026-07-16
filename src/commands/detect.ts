import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { success, warn, info } from "../ui.js";
import { detectLimitConfig, limitUntrackedBranches } from "./helpers/detect.js";

const DETECT_COMMIT_LIMIT = 2048;

const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Show what would be detected without making changes"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const detect = Command.make("detect", { dryRun: dryRunFlag, json: jsonFlag }).pipe(
  Command.withDescription("Detect and register branch stacks from git history"),
  Command.withExamples([
    { command: "stacked detect", description: "Auto-discover and register stacks" },
    { command: "stacked detect --dry-run", description: "Preview what would be detected" },
  ]),
  Command.withHandler(({ dryRun, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const trunk = yield* stacks.getTrunk();
      const allBranches = yield* git.listBranches();
      const candidates = allBranches.filter((b) => b !== trunk);

      const data = yield* stacks.load();
      const alreadyTracked = new Set(Object.keys(data.branches));
      const mergedBranches = new Set(data.mergedBranches);
      const untrackedAll = candidates.filter(
        (b) => !alreadyTracked.has(b) && !mergedBranches.has(b),
      );
      const detectLimit = yield* detectLimitConfig;
      const { untracked, skipped } = limitUntrackedBranches(untrackedAll, detectLimit);

      if (untracked.length === 0) {
        yield* info("No untracked branches found");
        return;
      }

      if (skipped > 0) {
        yield* warn(
          `Analyzing ${untracked.length}/${untrackedAll.length} untracked branches (set STACKED_DETECT_MAX_BRANCHES to adjust)`,
        );
      }

      const childOf = new Map<string, string>();
      const unclassified: string[] = [];

      // Include both untracked and already-tracked branches in tip resolution
      // so untracked branches can discover parents that are already in stacks
      const trackedBranches = [...alreadyTracked];
      const allCandidatesForTips = [...untracked, ...trackedBranches];

      const tipResults = yield* Effect.forEach(
        allCandidatesForTips,
        (branch) =>
          git.revParse(branch).pipe(
            Effect.map((oid) => [branch, oid] as const),
            Effect.catchTag("GitError", () => Effect.succeed(null)),
          ),
        { concurrency: 5 },
      );

      const tipOwners = new Map<string, string[]>();
      for (const result of tipResults) {
        if (result === null) continue;
        const [branch, oid] = result;
        const owners = tipOwners.get(oid) ?? [];
        owners.push(branch);
        tipOwners.set(oid, owners);
      }

      yield* Effect.forEach(
        untracked,
        (branch) =>
          Effect.gen(function* () {
            const commits = yield* git
              .firstParentUniqueCommits(branch, trunk, { limit: DETECT_COMMIT_LIMIT })
              .pipe(Effect.catchTag("GitError", () => Effect.succeed([])));

            if (commits.length === 0) {
              unclassified.push(branch);
              return;
            }

            let parent: string | null = null;
            let ambiguous = false;

            for (const oid of commits) {
              const owners = (tipOwners.get(oid) ?? []).filter((owner) => owner !== branch);
              if (owners.length > 1) {
                ambiguous = true;
                break;
              }
              const [owner] = owners;
              if (owner !== undefined) {
                parent = owner;
                break;
              }
            }

            if (ambiguous || (commits.length >= DETECT_COMMIT_LIMIT && parent === null)) {
              unclassified.push(branch);
              return;
            }

            childOf.set(branch, parent ?? trunk);
          }),
        { concurrency: 5 },
      );

      // Build linear chains from trunk
      // Find branches whose parent is trunk or a tracked branch (chain roots)
      const childrenByParent = new Map<string, string[]>();
      for (const branch of untracked) {
        const parent = childOf.get(branch);
        if (parent === undefined) continue;
        const children = childrenByParent.get(parent) ?? [];
        children.push(branch);
        childrenByParent.set(parent, children);
      }

      // Branches whose parent is already tracked — extend existing stacks
      const adoptions = new Map<string, string[]>(); // trackedParent → [children]
      for (const branch of untracked) {
        const parent = childOf.get(branch);
        if (parent !== undefined && alreadyTracked.has(parent)) {
          const siblings = childrenByParent.get(parent) ?? [];
          if (siblings.length === 1) {
            const existing = adoptions.get(parent) ?? [];
            // Walk the chain from this branch
            const chain = [branch];
            let current = branch;
            while (true) {
              const children = childrenByParent.get(current) ?? [];
              const child = children[0];
              if (children.length === 1 && child !== undefined) {
                chain.push(child);
                current = child;
              } else break;
            }
            adoptions.set(parent, [...existing, ...chain]);
          }
        }
      }

      const chains: string[][] = [];
      const roots = childrenByParent.get(trunk) ?? [];

      // Track branches consumed by adoptions so they're not double-counted
      const adoptedBranches = new Set<string>();
      for (const branches of adoptions.values()) {
        for (const b of branches) adoptedBranches.add(b);
      }

      for (const root of roots) {
        if (adoptedBranches.has(root)) continue;
        const chain = [root];
        let current = root;

        while (true) {
          const children = childrenByParent.get(current) ?? [];
          const child = children[0];
          if (children.length === 1 && child !== undefined && !adoptedBranches.has(child)) {
            chain.push(child);
            current = child;
          } else {
            // 0 children = end of chain, 2+ children = fork (skip)
            break;
          }
        }

        chains.push(chain);
      }

      // Report forks
      const forkPoints = untracked.filter((b) => (childrenByParent.get(b)?.length ?? 0) > 1);
      const forks = forkPoints.map((b) => ({
        branch: b,
        children: childrenByParent.get(b) ?? [],
      }));

      if (json) {
        const stacksData = chains.map((chain) => ({ name: chain[0] ?? "", branches: chain }));
        const adoptionData = [...adoptions.entries()].map(([parent, branches]) => ({
          parent,
          branches,
        }));
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(
          JSON.stringify({ stacks: stacksData, adoptions: adoptionData, forks }, null, 2),
        );
        return;
      }

      if (chains.length === 0 && adoptions.size === 0) {
        yield* info("No linear branch chains detected");
        return;
      }

      // Adopt branches into existing stacks
      for (const [parent, branches] of adoptions) {
        const parentStack = yield* stacks.findBranchStack(parent);
        if (parentStack === null) continue;
        let insertionParent = parent;
        for (const branch of branches) {
          if (dryRun) {
            yield* Console.error(
              `Would adopt "${branch}" into stack "${parentStack.name}" after "${insertionParent}"`,
            );
          } else {
            yield* stacks.addBranch(parentStack.name, branch, insertionParent);
            yield* success(
              `Adopted "${branch}" into stack "${parentStack.name}" after "${insertionParent}"`,
            );
          }
          insertionParent = branch;
        }
      }

      for (const chain of chains) {
        const name = chain[0];
        if (name === undefined) continue;
        const existing = yield* stacks.getStack(name);
        if (existing !== null) {
          yield* warn(`Stack "${name}" already exists, skipping: ${chain.join(" → ")}`);
          continue;
        }
        if (dryRun) {
          yield* Console.error(`Would create stack "${name}": ${chain.join(" → ")}`);
        } else {
          yield* stacks.createStack(name, chain);
          yield* success(`Created stack "${name}": ${chain.join(" → ")}`);
        }
      }

      if (dryRun) {
        const total = chains.length + adoptions.size;
        yield* Console.error(`\n${total} action${total === 1 ? "" : "s"} would be performed`);
      }

      if (forks.length > 0) {
        yield* warn("Forked branches detected (not supported yet):");
        for (const fork of forks) {
          yield* Console.error(`  ${fork.branch} → ${fork.children.join(", ")}`);
        }
      }

      if (unclassified.length > 0 && !json) {
        yield* warn(
          `Skipped ${unclassified.length} unclassified branch${unclassified.length === 1 ? "" : "es"}: ${unclassified.join(", ")}`,
        );
      }
    }),
  ),
);
