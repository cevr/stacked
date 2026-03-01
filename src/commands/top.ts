import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

export const top = Command.make("top").pipe(
  Command.withDescription("Checkout top branch of stack"),
  Command.withExamples([{ command: "stacked top", description: "Jump to the top of the stack" }]),
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

      const topBranch = result.stack.branches[result.stack.branches.length - 1];
      if (topBranch === undefined) {
        return yield* new StackError({
          message: "Stack is empty. Run 'stacked create <name>' to add a branch.",
        });
      }

      yield* git.checkout(topBranch);
      yield* Console.error(`Switched to ${topBranch}`);
    }),
  ),
);
