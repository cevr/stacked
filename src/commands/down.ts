import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

export const down = Command.make("down").pipe(
  Command.withDescription("Move down one branch in the stack"),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      const { branches } = result.stack;
      const idx = branches.indexOf(currentBranch);
      if (idx === -1) {
        return yield* new StackError({ message: "Current branch not found in stack" });
      }

      if (idx === 0) {
        return yield* new StackError({ message: "Already at the bottom of the stack" });
      }

      const prev = branches[idx - 1];
      if (prev === undefined) {
        return yield* new StackError({ message: "Already at the bottom of the stack" });
      }

      yield* git.checkout(prev);
      yield* Console.error(`Switched to ${prev}`);
    }),
  ),
);
