import { Command } from "effect/unstable/cli";
import { Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { success } from "../ui.js";

export const up = Command.make("up").pipe(
  Command.withDescription("Move up one branch in the stack"),
  Command.withExamples([{ command: "stacked up", description: "Move to the next branch above" }]),
  Command.withHandler(() =>
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

      const next = branches[idx + 1];
      if (next === undefined) {
        return yield* new StackError({
          code: ErrorCode.ALREADY_AT_TOP,
          message: "Already at the top of the stack",
        });
      }

      yield* git.checkout(next);
      yield* success(`Switched to ${next}`);
    }),
  ),
);
