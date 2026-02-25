import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

export const top = Command.make("top").pipe(
  Command.withDescription("Checkout top branch of stack"),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const result = yield* stacks.currentStack();
      if (result === null) {
        yield* Console.error("Not on a stacked branch");
        return;
      }

      const topBranch = result.stack.branches[result.stack.branches.length - 1];
      if (topBranch === undefined) {
        yield* Console.error("Stack is empty");
        return;
      }

      yield* git.checkout(topBranch);
      yield* Console.log(`Switched to ${topBranch}`);
    }),
  ),
);
