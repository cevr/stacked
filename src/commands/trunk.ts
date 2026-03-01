import { Argument, Command } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

const nameArg = Argument.string("name").pipe(Argument.optional);

export const trunk = Command.make("trunk", { name: nameArg }).pipe(
  Command.withDescription("Get or set the trunk branch"),
  Command.withExamples([
    { command: "stacked trunk", description: "Print current trunk branch" },
    { command: "stacked trunk develop", description: "Set trunk to develop" },
  ]),
  Command.withHandler(({ name }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;
      if (Option.isSome(name)) {
        const exists = yield* git.branchExists(name.value);
        if (!exists) {
          return yield* new StackError({ message: `Branch "${name.value}" does not exist` });
        }
        yield* stacks.setTrunk(name.value);
        yield* Console.error(`Trunk set to ${name.value}`);
      } else {
        const current = yield* stacks.getTrunk();
        yield* Console.log(current);
      }
    }),
  ),
);
