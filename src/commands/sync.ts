import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { withSpinner, success, warn } from "../ui.js";

const trunkFlag = Flag.string("trunk").pipe(
  Flag.optional,
  Flag.withAlias("t"),
  Flag.withDescription("Override trunk branch for this sync"),
);
const fromFlag = Flag.string("from").pipe(
  Flag.optional,
  Flag.withAlias("f"),
  Flag.withDescription("Start rebasing after this branch (exclusive)"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));
const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Show rebase plan without executing"),
);

interface SyncResult {
  name: string;
  action: "rebased" | "skipped" | "up-to-date";
  base: string;
}

export const sync = Command.make("sync", {
  trunk: trunkFlag,
  from: fromFlag,
  json: jsonFlag,
  dryRun: dryRunFlag,
}).pipe(
  Command.withDescription("Fetch and rebase stack on trunk. Use --from to start from a branch."),
  Command.withExamples([
    { command: "stacked sync", description: "Rebase entire stack on trunk" },
    { command: "stacked sync --from feat-auth", description: "Resume from a specific branch" },
    { command: "stacked sync --dry-run", description: "Preview rebase plan" },
  ]),
  Command.withHandler(({ trunk: trunkOpt, from: fromOpt, json, dryRun }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const trunk = Option.isSome(trunkOpt) ? trunkOpt.value : yield* stacks.getTrunk();
      const currentBranch = yield* git.currentBranch();

      if (!dryRun) {
        const clean = yield* git.isClean();
        if (!clean) {
          return yield* new StackError({
            code: ErrorCode.DIRTY_WORKTREE,
            message: "Working tree has uncommitted changes. Commit or stash before syncing.",
          });
        }
      }

      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({
          code: ErrorCode.NOT_IN_STACK,
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      const { branches } = result.stack;
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
        for (let i = startIdx; i < branches.length; i++) {
          const branch = branches[i];
          if (branch === undefined) continue;
          const base = i === 0 ? `origin/${trunk}` : (branches[i - 1] ?? `origin/${trunk}`);
          results.push({ name: branch, action: "skipped", base });
          if (!json) {
            yield* Console.error(`Would rebase ${branch} onto ${base}`);
          }
        }

        if (json) {
          // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
          yield* Console.log(JSON.stringify({ branches: results }, null, 2));
        } else {
          yield* Console.error(
            `\n${results.length} branch${results.length === 1 ? "" : "es"} would be rebased`,
          );
        }
        return;
      }

      yield* withSpinner(`Fetching ${trunk}`, git.fetch());

      yield* Effect.gen(function* () {
        for (let i = startIdx; i < branches.length; i++) {
          const branch = branches[i];
          if (branch === undefined) continue;
          const newBase = i === 0 ? `origin/${trunk}` : (branches[i - 1] ?? `origin/${trunk}`);

          // Compute old base (merge-base of this branch and its parent) before rebasing
          const oldBase = yield* git
            .mergeBase(branch, newBase)
            .pipe(Effect.catchTag("GitError", () => Effect.succeed(newBase)));

          yield* git.checkout(branch);
          yield* withSpinner(
            `Rebasing ${branch} onto ${newBase}`,
            git.rebaseOnto(branch, newBase, oldBase),
          ).pipe(
            Effect.catchTag("GitError", (e) => {
              const hint =
                i === 0 ? "stacked sync" : `stacked sync --from ${branches[i - 1] ?? trunk}`;
              return Effect.fail(
                new StackError({
                  code: ErrorCode.REBASE_CONFLICT,
                  message: `Rebase conflict on ${branch}: ${e.message}\n\nResolve conflicts, then run:\n  git rebase --continue\n  ${hint}`,
                }),
              );
            }),
          );
          results.push({ name: branch, action: "rebased", base: newBase });
        }
      }).pipe(
        Effect.ensuring(
          git
            .isRebaseInProgress()
            .pipe(
              Effect.andThen((inProgress) =>
                inProgress ? Effect.void : git.checkout(currentBranch).pipe(Effect.ignore),
              ),
            ),
        ),
      );

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branches: results }, null, 2));
      } else {
        yield* success("Stack synced");
      }
    }),
  ),
);
