import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { GitHubService } from "../services/GitHub.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";
import { success, warn, dim } from "../ui.js";

const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Show what would be removed without making changes"),
);

export const clean = Command.make("clean", { dryRun: dryRunFlag }).pipe(
  Command.withDescription("Remove merged branches from stacks (bottom-up)"),
  Command.withHandler(({ dryRun }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const gh = yield* GitHubService;
      const stacks = yield* StackService;

      const ghInstalled = yield* gh.isGhInstalled();
      if (!ghInstalled) {
        return yield* new StackError({
          message: "gh CLI is not installed. Install it from https://cli.github.com",
        });
      }

      let currentBranch = yield* git.currentBranch();
      const data = yield* stacks.load();

      // Fetch all PR statuses in parallel across all stacks
      const allBranches = Object.entries(data.stacks).flatMap(([stackName, stack]) =>
        stack.branches.map((branch) => ({ stackName, branch })),
      );

      const prResults = yield* Effect.forEach(
        allBranches,
        ({ branch }) =>
          gh.getPR(branch).pipe(
            Effect.catchTag("GitHubError", () => Effect.succeed(null)),
            Effect.map((pr) => [branch, pr] as const),
          ),
        { concurrency: 5 },
      );
      const prMap = new Map(prResults);

      const toRemove: Array<{ stackName: string; branch: string }> = [];
      const skippedMerged: Array<{ stackName: string; branch: string }> = [];

      for (const [stackName, stack] of Object.entries(data.stacks)) {
        let hitNonMerged = false;
        for (const branch of stack.branches) {
          const pr = prMap.get(branch) ?? null;
          const isMerged = pr !== null && pr.state === "MERGED";

          if (!hitNonMerged && isMerged) {
            toRemove.push({ stackName, branch });
          } else {
            if (!isMerged) hitNonMerged = true;
            if (isMerged) skippedMerged.push({ stackName, branch });
          }
        }
      }

      if (toRemove.length === 0) {
        yield* Console.error("Nothing to clean");
        if (skippedMerged.length > 0) {
          yield* warn(
            `${skippedMerged.length} merged branch${skippedMerged.length === 1 ? "" : "es"} skipped (non-merged branches below):`,
          );
          for (const { branch, stackName } of skippedMerged) {
            yield* Console.error(dim(`  ${branch} (${stackName})`));
          }
        }
        return;
      }

      for (const { stackName, branch } of toRemove) {
        if (dryRun) {
          yield* Console.error(`Would remove ${branch} from ${stackName}`);
        } else {
          if (currentBranch === branch) {
            const trunk = yield* stacks.getTrunk();
            yield* git.checkout(trunk);
            currentBranch = trunk;
          }
          yield* git
            .deleteBranch(branch, true)
            .pipe(
              Effect.catchTag("GitError", (e) =>
                Console.error(`Warning: failed to delete local branch ${branch}: ${e.message}`),
              ),
            );
          yield* git
            .deleteRemoteBranch(branch)
            .pipe(
              Effect.catchTag("GitError", (e) =>
                Console.error(`Warning: failed to delete remote branch ${branch}: ${e.message}`),
              ),
            );
          yield* stacks.removeBranch(stackName, branch);
          yield* success(`Removed ${branch} from ${stackName}`);
        }
      }

      if (dryRun) {
        yield* Console.error(
          `\n${toRemove.length} branch${toRemove.length === 1 ? "" : "es"} would be removed`,
        );
      } else {
        yield* success(
          `Cleaned ${toRemove.length} merged branch${toRemove.length === 1 ? "" : "es"}`,
        );
        yield* Console.error(dim("Run 'stacked sync' to rebase remaining branches onto trunk."));
      }

      if (skippedMerged.length > 0) {
        yield* warn(
          `${skippedMerged.length} merged branch${skippedMerged.length === 1 ? "" : "es"} skipped (non-merged branches below):`,
        );
        for (const { branch, stackName } of skippedMerged) {
          yield* Console.error(dim(`  ${branch} (${stackName})`));
        }
      }
    }),
  ),
);
