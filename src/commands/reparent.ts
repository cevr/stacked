import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { StackService } from "../services/Stack.js";
import { ErrorCode, StackError } from "../errors/index.js";
import { success, warn } from "../ui.js";
import { ensureSyncReady, runSync } from "./sync.js";

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
const syncFlag = Flag.boolean("sync").pipe(
  Flag.withDescription("Immediately merge and push the new lineage"),
);

const syncReparentedLineage = (branch: string) =>
  runSync({
    trunk: Option.none(),
    from: Option.none(),
    json: false,
    dryRun: false,
    continue: false,
    abort: false,
    includeMerged: false,
    targetBranch: branch,
  });

export const reparent = Command.make("reparent", {
  branch: branchArg,
  onto: ontoFlag,
  dryRun: dryRunFlag,
  json: jsonFlag,
  sync: syncFlag,
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
    {
      command: "stacked reparent feat-payments-ui --onto feat-api --sync",
      description: "Move the subtree, then immediately synchronize its new lineage",
    },
  ]),
  Command.withHandler(({ branch, onto, dryRun, json, sync }) =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      if (dryRun && sync) {
        return yield* new StackError({
          code: ErrorCode.USAGE_ERROR,
          message: "--sync cannot be combined with --dry-run",
        });
      }
      if (sync) yield* ensureSyncReady();

      const result = yield* stacks.reparentBranch(branch, onto, { dryRun });

      if (json) {
        if (sync) yield* syncReparentedLineage(branch);
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ ...result, synced: sync }, null, 2));
        return;
      }

      if (!result.changed) {
        if (sync) yield* syncReparentedLineage(branch);
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
      if (sync) {
        yield* syncReparentedLineage(branch);
      } else if (!dryRun) {
        yield* warn("Run 'stacked sync' to merge the new parent chain");
      }
    }),
  ),
);
