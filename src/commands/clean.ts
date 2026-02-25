import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { GitHubService } from "../services/GitHub.js";
import { StackService } from "../services/Stack.js";

const dryRunFlag = Flag.boolean("dry-run");

export const clean = Command.make("clean", { dryRun: dryRunFlag }).pipe(
  Command.withDescription("Remove merged branches from stacks"),
  Command.withHandler(({ dryRun }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const gh = yield* GitHubService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const data = yield* stacks.load();

      const merged: Array<{ stackName: string; branch: string }> = [];

      for (const [stackName, stack] of Object.entries(data.stacks)) {
        for (const branch of stack.branches) {
          const pr = yield* gh.getPR(branch).pipe(Effect.catch(() => Effect.succeed(null)));
          if (pr !== null && pr.state === "MERGED") {
            merged.push({ stackName, branch });
          }
        }
      }

      if (merged.length === 0) {
        yield* Console.log("Nothing to clean");
        return;
      }

      for (const { stackName, branch } of merged) {
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
          `\n${merged.length} branch${merged.length === 1 ? "" : "es"} would be removed`,
        );
      } else {
        yield* Console.log(
          `\nCleaned ${merged.length} merged branch${merged.length === 1 ? "" : "es"}`,
        );
      }
    }),
  ),
);
