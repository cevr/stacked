import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { success, warn } from "../ui.js";

const branchArg = Argument.string("branch").pipe(Argument.withDescription("Branch to move"));
const beforeFlag = Flag.string("before").pipe(
  Flag.optional,
  Flag.withDescription("Move branch before this branch"),
);
const afterFlag = Flag.string("after").pipe(
  Flag.optional,
  Flag.withDescription("Move branch after this branch"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const reorder = Command.make("reorder", {
  branch: branchArg,
  before: beforeFlag,
  after: afterFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Move a branch to a different position in the stack"),
  Command.withExamples([
    { command: "stacked reorder feat-b --before feat-a", description: "Move feat-b before feat-a" },
    { command: "stacked reorder feat-b --after feat-c", description: "Move feat-b after feat-c" },
  ]),
  Command.withHandler(({ branch, before, after, json }) =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      if (Option.isNone(before) && Option.isNone(after)) {
        return yield* new StackError({
          message: "Specify --before or --after to indicate target position",
        });
      }

      if (Option.isSome(before) && Option.isSome(after)) {
        return yield* new StackError({
          message: "Specify either --before or --after, not both",
        });
      }

      const result = yield* stacks.findBranchStack(branch);
      if (result === null) {
        return yield* new StackError({
          code: ErrorCode.BRANCH_NOT_FOUND,
          message: `Branch "${branch}" not found in any stack`,
        });
      }

      const { name: stackName, stack } = result;
      const branches = [...stack.branches];
      const currentIdx = branches.indexOf(branch);
      if (currentIdx === -1) return;

      const target = Option.isSome(before) ? before.value : Option.getOrElse(after, () => "");
      const targetIdx = branches.indexOf(target);
      if (targetIdx === -1) {
        return yield* new StackError({
          code: ErrorCode.BRANCH_NOT_FOUND,
          message: `Branch "${target}" not found in stack "${stackName}"`,
        });
      }

      // Remove from current position
      branches.splice(currentIdx, 1);

      // Insert at target position
      const newTargetIdx = branches.indexOf(target);
      if (Option.isSome(before)) {
        branches.splice(newTargetIdx, 0, branch);
      } else {
        branches.splice(newTargetIdx + 1, 0, branch);
      }

      const data = yield* stacks.load();
      yield* stacks.save({
        ...data,
        stacks: { ...data.stacks, [stackName]: { branches } },
      });

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branch, stack: stackName, branches }, null, 2));
      } else {
        yield* success(`Moved "${branch}" in stack "${stackName}"`);
        yield* warn("Run 'stacked sync' to rebase branches in new order");
      }
    }),
  ),
);
