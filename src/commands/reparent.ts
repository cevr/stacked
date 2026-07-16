import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { StackService } from "../services/Stack.js";
import { success, warn } from "../ui.js";

const branchArg = Argument.string("branch").pipe(
  Argument.withDescription("Branch whose subtree should move"),
);
const ontoFlag = Flag.string("onto").pipe(
  Flag.withDescription("New parent branch, or the configured trunk"),
);
const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Show the topology change without saving it"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const reparent = Command.make("reparent", {
  branch: branchArg,
  onto: ontoFlag,
  dryRun: dryRunFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Move a branch and its descendants onto a new parent"),
  Command.withExamples([
    {
      command: "stacked reparent feat-payments-ui --onto feat-api",
      description: "Move a subtree within or across stacks",
    },
    {
      command: "stacked reparent feat-payments-ui --onto main --dry-run",
      description: "Preview moving a subtree onto trunk as a new stack",
    },
  ]),
  Command.withHandler(({ branch, onto, dryRun, json }) =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const result = yield* stacks.reparentBranch(branch, onto, { dryRun });

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.changed) {
        yield* warn(`"${branch}" already has parent "${onto}"`);
        return;
      }

      if (dryRun) {
        yield* Console.error(`Would reparent "${branch}" onto "${onto}"`);
      } else {
        yield* success(`Reparented "${branch}" onto "${onto}"`);
      }
      yield* Console.error(
        `  "${result.destination.name}": ${result.destination.branches.join(" → ")}`,
      );
      if (result.source !== null && result.source.name !== result.destination.name) {
        yield* Console.error(`  "${result.source.name}": ${result.source.branches.join(" → ")}`);
      }
      if (!dryRun) yield* warn("Run 'stacked sync' to merge the new parent chain");
    }),
  ),
);
