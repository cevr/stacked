import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { GitHubService } from "../services/GitHub.js";
import { StackService } from "../services/Stack.js";

const dryRunFlag = Flag.boolean("dry-run");

export const clean = Command.make("clean", { dryRun: dryRunFlag }).pipe(
  Command.withDescription("Remove merged branches from stacks (bottom-up)"),
  Command.withHandler(({ dryRun }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const gh = yield* GitHubService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const data = yield* stacks.load();

      const toRemove: Array<{ stackName: string; branch: string }> = [];
      const skippedMerged: Array<{ stackName: string; branch: string }> = [];

      for (const [stackName, stack] of Object.entries(data.stacks)) {
        let hitNonMerged = false;
        for (const branch of stack.branches) {
          const pr = yield* gh.getPR(branch).pipe(Effect.catch(() => Effect.succeed(null)));
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
        yield* Console.log("Nothing to clean");
        if (skippedMerged.length > 0) {
          yield* Console.log(
            `\nNote: ${skippedMerged.length} merged branch${skippedMerged.length === 1 ? "" : "es"} skipped (non-merged branches below):`,
          );
          for (const { branch, stackName } of skippedMerged) {
            yield* Console.log(`  ${branch} (${stackName})`);
          }
        }
        return;
      }

      for (const { stackName, branch } of toRemove) {
        if (dryRun) {
          yield* Console.log(`Would remove ${branch} from ${stackName}`);
        } else {
          if (currentBranch === branch) {
            const trunk = yield* stacks.getTrunk();
            yield* git.checkout(trunk);
          }
          yield* stacks.removeBranch(stackName, branch);
          yield* git.deleteBranch(branch, true).pipe(Effect.catch(() => Effect.void));
          yield* Console.log(`Removed ${branch} from ${stackName}`);
        }
      }

      if (dryRun) {
        yield* Console.log(
          `\n${toRemove.length} branch${toRemove.length === 1 ? "" : "es"} would be removed`,
        );
      } else {
        yield* Console.log(
          `\nCleaned ${toRemove.length} merged branch${toRemove.length === 1 ? "" : "es"}`,
        );
      }

      if (skippedMerged.length > 0) {
        yield* Console.log(
          `\nNote: ${skippedMerged.length} merged branch${skippedMerged.length === 1 ? "" : "es"} skipped (non-merged branches below):`,
        );
        for (const { branch, stackName } of skippedMerged) {
          yield* Console.log(`  ${branch} (${stackName})`);
        }
      }
    }),
  ),
);
