import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { validateBranchName } from "./helpers/validate.js";

const nameArg = Argument.string("name").pipe(
  Argument.withDescription("Trunk branch name to set"),
  Argument.optional,
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const trunk = Command.make("trunk", { name: nameArg, json: jsonFlag }).pipe(
  Command.withDescription("Get or set the trunk branch"),
  Command.withExamples([
    { command: "stacked trunk", description: "Print current trunk branch" },
    { command: "stacked trunk develop", description: "Set trunk to develop" },
    { command: "stacked trunk --json", description: "JSON output" },
  ]),
  Command.withHandler(({ name, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;
      if (Option.isSome(name)) {
        yield* validateBranchName(name.value);
        const exists = yield* git.branchExists(name.value);
        if (!exists) {
          return yield* new StackError({
            code: ErrorCode.BRANCH_NOT_FOUND,
            message: `Branch "${name.value}" does not exist`,
          });
        }
        yield* stacks.setTrunk(name.value);
        if (json) {
          // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
          yield* Console.log(JSON.stringify({ trunk: name.value }, null, 2));
        } else {
          yield* Console.error(`Trunk set to ${name.value}`);
        }
      } else {
        const current = yield* stacks.getTrunk();
        if (json) {
          // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
          yield* Console.log(JSON.stringify({ trunk: current }, null, 2));
        } else {
          yield* Console.log(current);
        }
      }
    }),
  ),
);
