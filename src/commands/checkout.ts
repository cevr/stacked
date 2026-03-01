import { Argument, Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

const nameArg = Argument.string("name");

export const checkout = Command.make("checkout", { name: nameArg }).pipe(
  Command.withDescription("Switch to a branch (falls through to git if not in a stack)"),
  Command.withHandler(({ name }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const data = yield* stacks.load();
      let inStack = false;
      for (const stack of Object.values(data.stacks)) {
        if (stack.branches.includes(name)) {
          inStack = true;
          break;
        }
      }

      yield* git.checkout(name);
      if (inStack) {
        yield* Console.error(`Switched to ${name}`);
      } else {
        yield* Console.error(`Switched to ${name} (not in a stack)`);
      }
    }),
  ),
);
