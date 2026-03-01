import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { success } from "../ui.js";

const nameArg = Argument.string("name").pipe(Argument.withDescription("Branch name to check out"));
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const checkout = Command.make("checkout", { name: nameArg, json: jsonFlag }).pipe(
  Command.withDescription("Switch to a branch (falls through to git if not in a stack)"),
  Command.withExamples([
    { command: "stacked checkout feat-b", description: "Switch to a stacked branch" },
  ]),
  Command.withHandler(({ name, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const result = yield* stacks.findBranchStack(name);

      yield* git.checkout(name);

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branch: name, inStack: result !== null }, null, 2));
      } else if (result !== null) {
        yield* success(`Switched to ${name}`);
      } else {
        yield* success(`Switched to ${name} (not in a stack)`);
      }
    }),
  ),
);
