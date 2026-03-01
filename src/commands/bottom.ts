import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

export const bottom = Command.make("bottom").pipe(
  Command.withDescription("Checkout bottom branch of stack"),
  Command.withExamples([
    { command: "stacked bottom", description: "Jump to the bottom of the stack" },
  ]),
  Command.withHandler(() =>
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

      const bottomBranch = result.stack.branches[0];
      if (bottomBranch === undefined) {
        return yield* new StackError({
          message: "Stack is empty. Run 'stacked create <name>' to add a branch.",
        });
      }

      yield* git.checkout(bottomBranch);
      yield* Console.error(`Switched to ${bottomBranch}`);
    }),
  ),
);
