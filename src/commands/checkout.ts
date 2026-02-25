import { Argument, Command } from "effect/unstable/cli";
import { Effect } from "effect";
import { GitService } from "../services/Git.js";

const nameArg = Argument.string("name");

export const checkout = Command.make("checkout", { name: nameArg }).pipe(
  Command.withDescription("Switch to branch in current stack"),
  Command.withHandler(({ name }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      yield* git.checkout(name);
    }),
  ),
);
