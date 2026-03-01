import { Argument, Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

const nameArg = Argument.string("name");

export const checkout = Command.make("checkout", { name: nameArg }).pipe(
  Command.withDescription("Switch to branch in current stack"),
  Command.withHandler(({ name }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const data = yield* stacks.load();
      let found = false;
      for (const stack of Object.values(data.stacks)) {
        if (stack.branches.includes(name)) {
          found = true;
          break;
        }
      }

      if (!found) {
        return yield* new StackError({
          message: `Branch "${name}" is not tracked in any stack`,
        });
      }

      yield* git.checkout(name);
      yield* Console.log(`Switched to ${name}`);
    }),
  ),
);
