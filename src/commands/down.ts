import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { success } from "../ui.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const down = Command.make("down", { json: jsonFlag }).pipe(
  Command.withDescription("Move down one branch in the stack"),
  Command.withExamples([{ command: "stacked down", description: "Move to the next branch below" }]),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({
          code: ErrorCode.NOT_IN_STACK,
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      const { branches } = result.stack;
      const idx = branches.indexOf(currentBranch);
      if (idx === -1) {
        return yield* new StackError({
          code: ErrorCode.NOT_IN_STACK,
          message: "Current branch not found in stack",
        });
      }

      if (idx === 0) {
        return yield* new StackError({
          code: ErrorCode.ALREADY_AT_BOTTOM,
          message: "Already at the bottom of the stack",
        });
      }

      const prev = branches[idx - 1];
      if (prev === undefined) {
        return yield* new StackError({
          code: ErrorCode.ALREADY_AT_BOTTOM,
          message: "Already at the bottom of the stack",
        });
      }

      yield* git.checkout(prev);

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branch: prev, from: currentBranch }, null, 2));
      } else {
        yield* success(`Switched to ${prev}`);
      }
    }),
  ),
);
