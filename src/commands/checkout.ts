import { Argument, Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

const nameArg = Argument.string("name").pipe(Argument.withDescription("Branch name to check out"));

export const checkout = Command.make("checkout", { name: nameArg }).pipe(
  Command.withDescription("Switch to a branch (falls through to git if not in a stack)"),
  Command.withExamples([
    { command: "stacked checkout feat-b", description: "Switch to a stacked branch" },
  ]),
  Command.withHandler(({ name }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const result = yield* stacks.findBranchStack(name);

      yield* git.checkout(name);
      if (result !== null) {
        yield* Console.error(`Switched to ${name}`);
      } else {
        yield* Console.error(`Switched to ${name} (not in a stack)`);
      }
    }),
  ),
);
