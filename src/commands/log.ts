import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

export const log = Command.make("log").pipe(
  Command.withDescription("Show commits across all branches in stack"),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

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
        yield* Console.log(`\n── ${branch} ──`);
        const rangeLog = yield* git
          .log(`${base}..${branch}`, { oneline: true })
          .pipe(Effect.catch(() => Effect.succeed("(no commits)")));
        yield* Console.log(rangeLog || "(no new commits)");
      }
    }),
  ),
);
