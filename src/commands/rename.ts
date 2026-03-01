import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { success } from "../ui.js";

const oldArg = Argument.string("old").pipe(Argument.withDescription("Current stack name"));
const newArg = Argument.string("new").pipe(Argument.withDescription("New stack name"));
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const rename = Command.make("rename", { old: oldArg, new: newArg, json: jsonFlag }).pipe(
  Command.withDescription("Rename a stack (not the branches, just the stack key)"),
  Command.withExamples([
    { command: "stacked rename old-name new-name", description: "Rename a stack" },
  ]),
  Command.withHandler(({ old: oldName, new: newName, json }) =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      const data = yield* stacks.load();

      if (data.stacks[oldName] === undefined) {
        return yield* new StackError({
          code: ErrorCode.STACK_NOT_FOUND,
          message: `Stack "${oldName}" not found`,
        });
      }

      if (data.stacks[newName] !== undefined) {
        return yield* new StackError({
          code: ErrorCode.STACK_EXISTS,
          message: `Stack "${newName}" already exists`,
        });
      }

      const stack = data.stacks[oldName];
      if (stack === undefined) return;
      const { [oldName]: _, ...rest } = data.stacks;
      yield* stacks.save({ ...data, stacks: { ...rest, [newName]: stack } });

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ old: oldName, new: newName }, null, 2));
      } else {
        yield* success(`Renamed stack "${oldName}" to "${newName}"`);
      }
    }),
  ),
);
