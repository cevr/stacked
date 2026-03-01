import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const log = Command.make("log", { json: jsonFlag }).pipe(
  Command.withDescription("Show commits across all branches in stack"),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      const trunk = yield* stacks.getTrunk();
      const { branches } = result.stack;

      if (json) {
        const entries = [];
        for (let i = 0; i < branches.length; i++) {
          const branch = branches[i];
          if (branch === undefined) continue;
          const base = i === 0 ? trunk : (branches[i - 1] ?? trunk);
          const commits = yield* git
            .log(`${base}..${branch}`, { oneline: true })
            .pipe(Effect.catchTag("GitError", () => Effect.succeed("")));
          entries.push({ name: branch, base, commits: commits || "" });
        }
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branches: entries }, null, 2));
        return;
      }

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        if (branch === undefined) continue;
        const base = i === 0 ? trunk : (branches[i - 1] ?? trunk);
        yield* Console.log(`\n── ${branch} ──`);
        const rangeLog = yield* git
          .log(`${base}..${branch}`, { oneline: true })
          .pipe(Effect.catchTag("GitError", () => Effect.succeed("(no commits)")));
        yield* Console.log(rangeLog || "(no new commits)");
      }
    }),
  ),
);
