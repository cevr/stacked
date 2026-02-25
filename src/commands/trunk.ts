import { Argument, Command } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { StackService } from "../services/Stack.js";

const nameArg = Argument.string("name").pipe(Argument.optional);

export const trunk = Command.make("trunk", { name: nameArg }).pipe(
  Command.withDescription("Get or set the trunk branch"),
  Command.withHandler(({ name }) =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      if (Option.isSome(name)) {
        yield* stacks.setTrunk(name.value);
        yield* Console.log(`Trunk set to ${name.value}`);
      } else {
        const current = yield* stacks.getTrunk();
        yield* Console.log(current);
      }
    }),
  ),
);
