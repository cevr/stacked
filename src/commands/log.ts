import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const log = Command.make("log", { json: jsonFlag }).pipe(
  Command.withDescription("Show commits across all branches in stack"),
  Command.withExamples([
    { command: "stacked log", description: "Show commits per branch" },
    { command: "stacked log --json", description: "JSON output" },
  ]),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const lineage = yield* stacks.currentLineage();
      if (lineage === null) {
        return yield* new StackError({
          code: ErrorCode.NOT_IN_STACK,
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      if (json) {
        const entries = [];
        for (const branch of lineage.branches) {
          const commits = yield* git
            .log(`${branch.activeParent}..${branch.name}`, { oneline: true })
            .pipe(Effect.catchTag("GitError", () => Effect.succeed("")));
          entries.push({ name: branch.name, base: branch.activeParent, commits: commits || "" });
        }
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branches: entries }, null, 2));
        return;
      }

      for (const branch of lineage.branches) {
        yield* Console.log(`\n── ${branch.name} ──`);
        const rangeLog = yield* git
          .log(`${branch.activeParent}..${branch.name}`, { oneline: true })
          .pipe(Effect.catchTag("GitError", () => Effect.succeed("(no commits)")));
        yield* Console.log(rangeLog || "(no new commits)");
      }
    }),
  ),
);
