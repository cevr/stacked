import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { stdout } from "../ui.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const status = Command.make("status", { json: jsonFlag }).pipe(
  Command.withDescription("Show current branch, stack position, and working tree state"),
  Command.withExamples([
    { command: "stacked status", description: "Show where you are in the stack" },
    { command: "stacked status --json", description: "JSON output" },
  ]),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const clean = yield* git.isClean();
      const result = yield* stacks.currentStack();

      if (json) {
        const stack =
          result !== null
            ? {
                name: result.name,
                position: result.stack.branches.indexOf(currentBranch) + 1,
                total: result.stack.branches.length,
              }
            : null;
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branch: currentBranch, clean, stack }, null, 2));
        return;
      }

      const lines: string[] = [];
      lines.push(`Branch: ${stdout.bold(currentBranch)}`);
      lines.push(`Working tree: ${clean ? stdout.green("clean") : stdout.yellow("dirty")}`);

      if (result !== null) {
        const { branches } = result.stack;
        const idx = branches.indexOf(currentBranch);
        lines.push(
          `Stack: ${stdout.bold(result.name)} ${stdout.dim(`(${idx + 1} of ${branches.length})`)}`,
        );
      } else {
        lines.push(stdout.dim("Not in a stack. Run 'stacked create <name>' to start one."));
      }

      yield* Console.log(lines.join("\n"));
    }),
  ),
);
