import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { GitHubService } from "../services/GitHub.js";

const draftFlag = Flag.boolean("draft").pipe(Flag.withAlias("d"));
const forceFlag = Flag.boolean("force").pipe(Flag.withAlias("f"));
const dryRunFlag = Flag.boolean("dry-run");

export const submit = Command.make("submit", {
  draft: draftFlag,
  force: forceFlag,
  dryRun: dryRunFlag,
}).pipe(
  Command.withDescription("Push all stack branches and create/update PRs via gh"),
  Command.withHandler(({ draft, force, dryRun }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;
      const gh = yield* GitHubService;

      const result = yield* stacks.currentStack();
      if (result === null) {
        yield* Console.error("Not on a stacked branch");
        return;
      }

      const trunk = yield* stacks.getTrunk();
      const { branches } = result.stack;

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        if (branch === undefined) continue;
        const base = i === 0 ? trunk : (branches[i - 1] ?? trunk);

        if (dryRun) {
          yield* Console.log(`Would push ${branch} and create/update PR (base: ${base})`);
          continue;
        }

        yield* Console.log(`Pushing ${branch}...`);
        yield* git.push(branch, { force });

        const existingPR = yield* gh.getPR(branch);

        if (existingPR !== null) {
          if (existingPR.base !== base) {
            yield* Console.log(`Updating PR #${existingPR.number} base to ${base}`);
            yield* gh.updatePR({ branch, base });
          } else {
            yield* Console.log(`PR #${existingPR.number} already exists: ${existingPR.url}`);
          }
        } else {
          const pr = yield* gh.createPR({
            head: branch,
            base,
            title: branch,
            draft,
          });
          yield* Console.log(`Created PR #${pr.number}: ${pr.url}`);
        }
      }

      yield* Console.log("Done");
    }),
  ),
);
