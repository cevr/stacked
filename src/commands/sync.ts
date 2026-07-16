import { Command, Flag } from "effect/unstable/cli";
import { Console, type Context, Effect, FileSystem, Option } from "effect";
import { GitService } from "../services/Git.js";
import { GitHubService } from "../services/GitHub.js";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { refreshStackedPRBodies } from "./helpers/pr-metadata.js";
import { withSpinner, success, warn } from "../ui.js";

type GitApi = Context.Service.Shape<typeof GitService>;
type StackApi = Context.Service.Shape<typeof StackService>;
type GitHubApi = Context.Service.Shape<typeof GitHubService>;

const detectMergedBranches = Effect.fn("detectMergedBranches")(function* (opts: {
  branches: readonly string[];
  gh: GitHubApi;
  stacks: StackApi;
}) {
  const ghInstalled = yield* opts.gh.isGhInstalled();
  if (!ghInstalled) {
    const data = yield* opts.stacks.load();
    return new Set(data.mergedBranches);
  }

  const prEntries = yield* Effect.forEach(
    opts.branches,
    (branch) =>
      opts.gh.getPR(branch).pipe(
        Effect.map((pr) => [branch, pr] as const),
        Effect.catchTag("GitHubError", () => Effect.succeed([branch, null] as const)),
      ),
    { concurrency: 5 },
  );

  const mergedNow = prEntries.filter(([, pr]) => pr?.state === "MERGED").map(([branch]) => branch);
  const activeNow = prEntries
    .filter(([, pr]) => pr !== null && pr.state !== "MERGED")
    .map(([branch]) => branch);

  yield* opts.stacks.markMergedBranches(mergedNow);
  yield* opts.stacks.unmarkMergedBranches(activeNow);

  const data = yield* opts.stacks.load();
  return new Set(data.mergedBranches);
});

const trunkFlag = Flag.string("trunk").pipe(
  Flag.optional,
  Flag.withAlias("t"),
  Flag.withDescription("Override trunk branch for this sync"),
);
const fromFlag = Flag.string("from").pipe(
  Flag.optional,
  Flag.withAlias("f"),
  Flag.withDescription("Start merging after this branch (exclusive)"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));
const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Show merge plan without executing"),
);
const continueFlag = Flag.boolean("continue").pipe(
  Flag.withDescription("Continue sync after resolving conflicts"),
);
const abortFlag = Flag.boolean("abort").pipe(
  Flag.withDescription("Abort sync and discard in-progress merge"),
);
const includeMergedFlag = Flag.boolean("include-merged").pipe(
  Flag.withDescription("Include branches whose PRs are already merged in the sync loop"),
);

interface SyncResult {
  name: string;
  action: "merged" | "up-to-date" | "pushed";
  base: string;
}

interface SyncState {
  version: 1;
  conflictedBranch: string;
  newBaseTip: string;
  stackName: string;
  originalBranch: string;
  remainingBranches: string[];
}

const syncStatePath = (gitDir: string) => `${gitDir}/stacked-sync-state.json`;

const readSyncState = (
  gitDir: string,
): Effect.Effect<SyncState | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = syncStatePath(gitDir);
    const exists = yield* fs.exists(path);
    if (!exists) return null;
    const content = yield* fs.readFileString(path);
    return yield* Effect.try({
      try: () => JSON.parse(content) as SyncState,
      catch: () => new StackError({ message: "Failed to read sync state" }),
    });
  }).pipe(Effect.catch(() => Effect.succeed(null)));

const writeSyncState = (gitDir: string, state: SyncState) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = syncStatePath(gitDir);
    const tmpPath = `${path}.tmp`;
    yield* fs.writeFileString(tmpPath, JSON.stringify(state, null, 2));
    yield* fs.rename(tmpPath, path);
  }).pipe(
    Effect.mapError(() => new StackError({ message: "Failed to write sync state" })),
    Effect.asVoid,
  );

const deleteSyncState = (gitDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(syncStatePath(gitDir), { force: true });
  }).pipe(
    Effect.mapError(() => new StackError({ message: "Failed to delete sync state" })),
    Effect.ignore,
  );

export const sync = Command.make("sync", {
  trunk: trunkFlag,
  from: fromFlag,
  json: jsonFlag,
  dryRun: dryRunFlag,
  continue: continueFlag,
  abort: abortFlag,
  includeMerged: includeMergedFlag,
}).pipe(
  Command.withDescription(
    "Fetch, merge parent into each stack branch, and push. Use --from to start from a branch.",
  ),
  Command.withExamples([
    {
      command: "stacked sync",
      description: "Fast-forward trunk, then merge parent into each child",
    },
    { command: "stacked sync --from feat-auth", description: "Resume from a specific branch" },
    { command: "stacked sync --dry-run", description: "Preview merge plan" },
    { command: "stacked sync --continue", description: "Continue after resolving conflicts" },
    { command: "stacked sync --abort", description: "Abort sync and discard in-progress merge" },
    {
      command: "stacked sync --include-merged",
      description: "Force-include branches whose PRs are already merged",
    },
  ]),
  Command.withHandler((opts) => runSync(opts)),
);

export interface RunSyncOptions {
  readonly trunk: Option.Option<string>;
  readonly from: Option.Option<string>;
  readonly json: boolean;
  readonly dryRun: boolean;
  readonly continue: boolean;
  readonly abort: boolean;
  readonly includeMerged: boolean;
}

export const runSync = ({
  trunk: trunkOpt,
  from: fromOpt,
  json,
  dryRun,
  continue: continueMode,
  abort: abortMode,
  includeMerged,
}: RunSyncOptions) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const gh = yield* GitHubService;
    const stacks = yield* StackService;

    const gitDir = yield* git.revParse("--absolute-git-dir");

    if (abortMode) {
      const state = yield* readSyncState(gitDir);
      if (state === null) {
        return yield* new StackError({
          code: ErrorCode.USAGE_ERROR,
          message: "No sync in progress. Nothing to abort.",
        });
      }
      yield* git.mergeAbort();
      yield* git.checkout(state.originalBranch).pipe(Effect.ignore);
      yield* deleteSyncState(gitDir);
      yield* success("Sync aborted");
      return;
    }

    if (continueMode) {
      const state = yield* readSyncState(gitDir);
      if (state === null) {
        return yield* new StackError({
          code: ErrorCode.USAGE_ERROR,
          message: "No sync in progress. Nothing to continue.",
        });
      }

      const { conflictedBranch, newBaseTip, stackName, originalBranch, remainingBranches } = state;

      yield* withSpinner(`Finalizing merge on ${conflictedBranch}`, git.mergeContinue());
      yield* stacks.updateSyncedOnto(conflictedBranch, newBaseTip);
      yield* withSpinner(`Pushing ${conflictedBranch}`, git.push(conflictedBranch));
      yield* deleteSyncState(gitDir);

      const results: SyncResult[] = [{ name: conflictedBranch, action: "merged", base: "parent" }];

      if (remainingBranches.length > 0) {
        const trunk = Option.isSome(trunkOpt) ? trunkOpt.value : yield* stacks.getTrunk();
        const originTrunk = `origin/${trunk}`;
        const recordedLineage = yield* stacks.getLineage(conflictedBranch, { includeMerged: true });
        if (recordedLineage === null) {
          yield* warn(`Stack not found for "${conflictedBranch}" — skipping remaining branches`);
        } else {
          const allBranches = recordedLineage.branches.map(({ name }) => name);
          yield* detectMergedBranches({
            branches: allBranches,
            gh,
            stacks,
          });
          const lineage = yield* stacks.getLineage(conflictedBranch, { includeMerged });
          const remaining = new Set(remainingBranches);
          const activeRemaining =
            lineage?.branches.filter(
              (branch) => remaining.has(branch.name) && (includeMerged || !branch.merged),
            ) ?? [];

          yield* Effect.gen(function* () {
            for (let index = 0; index < activeRemaining.length; index++) {
              const branch = activeRemaining[index];
              if (branch === undefined) continue;
              const base =
                branch.activeParent === recordedLineage.trunk ? originTrunk : branch.activeParent;
              const syncResult = yield* syncOneBranch({
                git,
                stacks,
                branch: branch.name,
                effectiveBase: base,
                gitDir,
                originalBranch,
                allBranches,
                remainingBranches: activeRemaining.slice(index + 1).map(({ name }) => name),
                stackName,
              });
              results.push(syncResult);
            }
          }).pipe(
            Effect.ensuring(
              git
                .isMergeInProgress()
                .pipe(
                  Effect.andThen((inProgress) =>
                    inProgress ? Effect.void : git.checkout(originalBranch).pipe(Effect.ignore),
                  ),
                ),
            ),
          );
        }
      } else {
        yield* git.checkout(originalBranch).pipe(Effect.ignore);
      }

      const ghInstalled = yield* gh.isGhInstalled();
      if (ghInstalled) {
        const stackResult = yield* stacks.findBranchStack(conflictedBranch);
        if (stackResult !== null) {
          yield* refreshStackedPRBodies({
            branches: stackResult.stack.branches,
            stackName,
            gh,
          }).pipe(Effect.ignore);
        }
      }

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branches: results }, null, 2));
      } else {
        yield* success("Sync continued successfully");
      }
      return;
    }

    // Normal sync flow
    const trunk = Option.isSome(trunkOpt) ? trunkOpt.value : yield* stacks.getTrunk();
    const originTrunk = `origin/${trunk}`;
    const currentBranch = yield* git.currentBranch();

    const existingState = yield* readSyncState(gitDir);
    if (existingState !== null) {
      return yield* new StackError({
        code: ErrorCode.USAGE_ERROR,
        message: `Sync recovery in progress on "${existingState.conflictedBranch}". Use --continue or --abort.`,
      });
    }

    if (!dryRun) {
      const clean = yield* git.isClean();
      if (!clean) {
        return yield* new StackError({
          code: ErrorCode.DIRTY_WORKTREE,
          message: "Working tree has uncommitted changes. Commit or stash before syncing.",
        });
      }
    }

    const recordedLineage = yield* stacks.currentLineage({ includeMerged: true });
    if (recordedLineage === null) {
      return yield* new StackError({
        code: ErrorCode.NOT_IN_STACK,
        message:
          "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
      });
    }

    const branches = recordedLineage.branches.map(({ name }) => name);
    yield* detectMergedBranches({ branches, gh, stacks });
    const lineage = yield* stacks.currentLineage({ includeMerged });
    if (lineage === null) {
      return yield* new StackError({
        code: ErrorCode.NOT_IN_STACK,
        message: "Stack lineage disappeared while refreshing merged branches.",
      });
    }

    const fromBranch = Option.isSome(fromOpt) ? fromOpt.value : undefined;

    let startIdx = 0;
    if (fromBranch !== undefined) {
      const idx = branches.indexOf(fromBranch);
      if (idx === -1) {
        return yield* new StackError({
          code: ErrorCode.BRANCH_NOT_FOUND,
          message: `Branch "${fromBranch}" not found in stack`,
        });
      }
      startIdx = idx + 1;
      if (startIdx >= branches.length) {
        yield* warn(`Nothing to sync — ${fromBranch} is the last branch in the stack`);
        return;
      }
    }

    const results: SyncResult[] = [];

    if (dryRun) {
      results.push({ name: trunk, action: "merged", base: originTrunk });
      if (!json) {
        yield* Console.error(`${trunk}: fast-forward onto ${originTrunk}`);
      }

      for (let i = startIdx; i < lineage.branches.length; i++) {
        const branch = lineage.branches[i];
        if (branch === undefined || (!includeMerged && branch.merged)) continue;
        const base = branch.activeParent === lineage.trunk ? originTrunk : branch.activeParent;

        const newBaseTip = yield* git.revParse(base);
        const branchHead = yield* git.revParse(branch.name);
        const syncedOnto = yield* stacks.getSyncedOnto(branch.name);

        let mergeAction: "merged" | "up-to-date";
        if (syncedOnto !== null && syncedOnto === newBaseTip) {
          mergeAction = "up-to-date";
        } else {
          const alreadyIncorporated = yield* git
            .isAncestor(newBaseTip, branchHead)
            .pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));
          mergeAction = alreadyIncorporated ? "up-to-date" : "merged";
        }

        let action: SyncResult["action"] = mergeAction;
        if (mergeAction === "up-to-date") {
          const { ahead, hasRemote } = yield* git
            .aheadCount(branch.name)
            .pipe(Effect.catchTag("GitError", () => Effect.succeed({ ahead: 0, hasRemote: true })));
          if (!hasRemote || ahead > 0) action = "pushed";
        }

        results.push({ name: branch.name, action, base });
        if (!json) {
          const verb =
            action === "up-to-date"
              ? "up-to-date"
              : action === "pushed"
                ? "push (unpushed commits)"
                : `merge ${base}`;
          yield* Console.error(`${branch.name}: ${verb}`);
        }
      }

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branches: results }, null, 2));
      } else {
        const changed = results.filter((r) => r.action !== "up-to-date").length;
        const skipped = results.filter((r) => r.action === "up-to-date").length;
        const parts: string[] = [];
        if (changed > 0) parts.push(`${changed} to sync`);
        if (skipped > 0) parts.push(`${skipped} up-to-date`);
        yield* Console.error(`\n${parts.join(", ")}`);
      }
      return;
    }

    yield* Effect.gen(function* () {
      yield* withSpinner(`Fetching ${trunk}`, git.fetch());
      yield* git.checkout(trunk);
      yield* withSpinner(
        `Fast-forwarding ${trunk} to ${originTrunk}`,
        git.mergeFastForward(originTrunk),
      ).pipe(
        Effect.catchTag("GitError", (e) =>
          Effect.fail(
            new StackError({
              code: ErrorCode.SYNC_CONFLICT,
              message: `Cannot fast-forward ${trunk} onto ${originTrunk}: ${e.message}\n\n${trunk} has local commits that diverge from ${originTrunk}. Reconcile manually before syncing.`,
            }),
          ),
        ),
      );
      results.push({ name: trunk, action: "merged", base: originTrunk });

      for (let i = startIdx; i < lineage.branches.length; i++) {
        const branch = lineage.branches[i];
        if (branch === undefined || (!includeMerged && branch.merged)) continue;
        const newBase = branch.activeParent === lineage.trunk ? originTrunk : branch.activeParent;

        const remainingActive = lineage.branches
          .slice(i + 1)
          .filter((entry) => includeMerged || !entry.merged)
          .map(({ name }) => name);

        const syncResult = yield* syncOneBranch({
          git,
          stacks,
          branch: branch.name,
          effectiveBase: newBase,
          gitDir,
          originalBranch: currentBranch,
          allBranches: branches,
          remainingBranches: remainingActive,
          stackName: lineage.name,
        });
        results.push(syncResult);
      }
    }).pipe(
      Effect.ensuring(
        readSyncState(gitDir).pipe(
          Effect.andThen((state) =>
            state !== null
              ? Effect.void
              : git
                  .isMergeInProgress()
                  .pipe(
                    Effect.andThen((inProgress) =>
                      inProgress ? Effect.void : git.checkout(currentBranch).pipe(Effect.ignore),
                    ),
                  ),
          ),
        ),
      ),
    );

    const ghInstalled = yield* gh.isGhInstalled();
    if (ghInstalled) {
      yield* refreshStackedPRBodies({
        branches,
        stackName: lineage.name,
        gh,
      });
    }

    if (json) {
      // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
      yield* Console.log(JSON.stringify({ branches: results }, null, 2));
    } else {
      yield* success(`Stack synced (including trunk ${trunk})`);
    }
  });

// ---------------------------------------------------------------------------
// Per-branch sync logic (shared between normal sync and --continue resume)
// ---------------------------------------------------------------------------

const syncOneBranch = Effect.fn("syncOneBranch")(function* (opts: {
  git: GitApi;
  stacks: StackApi;
  branch: string;
  effectiveBase: string;
  gitDir: string;
  originalBranch: string;
  allBranches: readonly string[];
  remainingBranches: readonly string[];
  stackName: string;
}) {
  const { git, stacks, branch, effectiveBase: newBase, gitDir } = opts;

  const newBaseTip = yield* git.revParse(newBase);
  const branchHead = yield* git.revParse(branch);
  const syncedOnto = yield* stacks.getSyncedOnto(branch);

  const pushIfUnpushed = Effect.gen(function* () {
    const { ahead, hasRemote } = yield* git
      .aheadCount(branch)
      .pipe(Effect.catchTag("GitError", () => Effect.succeed({ ahead: 0, hasRemote: true })));
    if (hasRemote && ahead === 0) return false;
    yield* withSpinner(`Pushing ${branch}`, git.push(branch));
    return true;
  });

  if (syncedOnto !== null && syncedOnto === newBaseTip) {
    const pushed = yield* pushIfUnpushed;
    return {
      name: branch,
      action: pushed ? ("pushed" as const) : ("up-to-date" as const),
      base: newBase,
    };
  }

  const alreadyIncorporated = yield* git
    .isAncestor(newBaseTip, branchHead)
    .pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));
  if (alreadyIncorporated) {
    yield* stacks.updateSyncedOnto(branch, newBaseTip);
    const pushed = yield* pushIfUnpushed;
    return {
      name: branch,
      action: pushed ? ("pushed" as const) : ("up-to-date" as const),
      base: newBase,
    };
  }

  yield* git.checkout(branch);
  const mergeResult = yield* git
    .mergeBranch({ base: newBase, message: `sync: merge ${newBase} into ${branch}` })
    .pipe(Effect.catchTag("GitError", () => Effect.succeed({ action: "conflict" as const })));

  if (mergeResult.action === "conflict") {
    yield* writeSyncState(gitDir, {
      version: 1,
      conflictedBranch: branch,
      newBaseTip,
      stackName: opts.stackName,
      originalBranch: opts.originalBranch,
      remainingBranches: [...opts.remainingBranches],
    });

    const files = yield* git.conflictedFiles().pipe(Effect.orElseSucceed(() => [] as string[]));
    const fileList = files.length > 0 ? `\n${files.map((f) => `  ${f}`).join("\n")}` : "";
    return yield* new StackError({
      code: ErrorCode.SYNC_CONFLICT,
      message: `Conflict on ${branch} (${files.length} file${files.length === 1 ? "" : "s"}):${fileList}\n\nResolve conflicts, then:\n  git add <resolved-files> && stacked sync --continue\n\nOr abort:\n  stacked sync --abort`,
    });
  }

  yield* stacks.updateSyncedOnto(branch, newBaseTip);

  if (mergeResult.action === "merged") {
    yield* withSpinner(`Pushing ${branch}`, git.push(branch));
    return { name: branch, action: "merged" as const, base: newBase };
  }

  const pushed = yield* pushIfUnpushed;
  return {
    name: branch,
    action: pushed ? ("pushed" as const) : ("up-to-date" as const),
    base: newBase,
  };
});
