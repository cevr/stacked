import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

export const up = Command.make("up").pipe(
  Command.withDescription("Move up one branch in the stack"),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({ message: "Not on a stacked branch" });
      }

      const { branches } = result.stack;
      const idx = branches.indexOf(currentBranch);
      if (idx === -1) {
        return yield* new StackError({ message: "Current branch not found in stack" });
      }

      const next = branches[idx + 1];
      if (next === undefined) {
        return yield* new StackError({ message: "Already at the top of the stack" });
      }

      yield* git.checkout(next);
      yield* Console.error(`Switched to ${next}`);
    }),
  ),
);
