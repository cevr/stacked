import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { success } from "../ui.js";

const branchArg = Argument.string("branch").pipe(
  Argument.withDescription("Branch at which to split the stack"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));
const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Show what would happen without making changes"),
);

export const split = Command.make("split", {
  branch: branchArg,
  json: jsonFlag,
  dryRun: dryRunFlag,
}).pipe(
  Command.withDescription("Split a stack at a branch — branches at and above become a new stack"),
  Command.withExamples([
    { command: "stacked split feat-b", description: "Split at feat-b" },
    { command: "stacked split feat-b --dry-run", description: "Preview the split" },
  ]),
  Command.withHandler(({ branch, json, dryRun }) =>
    Effect.gen(function* () {
      const stacks = yield* StackService;

      const result = yield* stacks.findBranchStack(branch);
      if (result === null) {
        return yield* new StackError({
          code: ErrorCode.BRANCH_NOT_FOUND,
          message: `Branch "${branch}" not found in any stack`,
        });
      }

      const { name: stackName, stack } = result;
      const splitIdx = stack.branches.indexOf(branch);
      const below = stack.branches.slice(0, splitIdx);
      const above = stack.branches.slice(splitIdx);
      const newStackName = branch;

      if (dryRun) {
        if (json) {
          // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
          yield* Console.log(
            JSON.stringify(
              {
                original: { name: stackName, branches: below },
                new: { name: newStackName, branches: above },
              },
              null,
              2,
            ),
          );
        } else {
          yield* Console.error(`Would keep "${stackName}": ${below.join(" → ")}`);
          yield* Console.error(`Would create "${newStackName}": ${above.join(" → ")}`);
        }
        return;
      }

      yield* stacks.splitStack(branch);

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(
          JSON.stringify(
            {
              original: { name: stackName, branches: below },
              new: { name: newStackName, branches: above },
            },
            null,
            2,
          ),
        );
      } else {
        yield* success(`Split stack "${stackName}" at "${branch}"`);
        yield* Console.error(`  "${stackName}": ${below.join(" → ")}`);
        yield* Console.error(`  "${newStackName}": ${above.join(" → ")}`);
      }
    }),
  ),
);
