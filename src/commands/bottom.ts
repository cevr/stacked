import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

export const bottom = Command.make("bottom").pipe(
  Command.withDescription("Checkout bottom branch of stack"),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const result = yield* stacks.currentStack();
      if (result === null) {
        yield* Console.error("Not on a stacked branch");
        return;
      }

      const bottomBranch = result.stack.branches[0];
      if (bottomBranch === undefined) {
        yield* Console.error("Stack is empty");
        return;
      }

      yield* git.checkout(bottomBranch);
      yield* Console.log(`Switched to ${bottomBranch}`);
    }),
  ),
);
