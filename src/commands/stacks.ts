import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const stacks = Command.make("stacks", { json: jsonFlag }).pipe(
  Command.withDescription("List all stacks in the repo"),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stackService = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const data = yield* stackService.load();

      const entries = Object.entries(data.stacks);
      if (entries.length === 0) {
        if (json) {
          // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
          yield* Console.log(JSON.stringify({ stacks: [] }));
        } else {
          yield* Console.error("No stacks");
        }
        return;
      }

      if (json) {
        const stackList = entries.map(([name, stack]) => ({
          name,
          branches: stack.branches.length,
          current: stack.branches.includes(currentBranch),
        }));
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ stacks: stackList }, null, 2));
        return;
      }

      const lines: string[] = [];
      for (const [name, stack] of entries) {
        const isCurrent = stack.branches.includes(currentBranch);
        const marker = isCurrent ? "* " : "  ";
        const count = stack.branches.length;
        lines.push(`${marker}${name} (${count} branch${count === 1 ? "" : "es"})`);
      }

      yield* Console.log(lines.join("\n"));
    }),
  ),
);
