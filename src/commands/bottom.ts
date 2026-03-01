import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { success } from "../ui.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const bottom = Command.make("bottom", { json: jsonFlag }).pipe(
  Command.withDescription("Checkout bottom branch of stack"),
  Command.withExamples([
    { command: "stacked bottom", description: "Jump to the bottom of the stack" },
  ]),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({
          code: ErrorCode.NOT_IN_STACK,
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      const bottomBranch = result.stack.branches[0];
      if (bottomBranch === undefined) {
        return yield* new StackError({
          code: ErrorCode.STACK_EMPTY,
          message: "Stack is empty. Run 'stacked create <name>' to add a branch.",
        });
      }

      yield* git.checkout(bottomBranch);

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branch: bottomBranch }, null, 2));
      } else {
        yield* success(`Switched to ${bottomBranch}`);
      }
    }),
  ),
);
