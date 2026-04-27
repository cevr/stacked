import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { stdout } from "../ui.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

interface BranchStatus {
  name: string;
  current: boolean;
  ahead: number;
  hasRemote: boolean;
}

export const status = Command.make("status", { json: jsonFlag }).pipe(
  Command.withDescription("Show current branch, stack position, and per-branch push state"),
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

      const branchStatuses: BranchStatus[] =
        result === null
          ? []
          : yield* Effect.forEach(
              result.stack.branches,
              (branch) =>
                git.aheadCount(branch).pipe(
                  Effect.map(({ ahead, hasRemote }) => ({
                    name: branch,
                    current: branch === currentBranch,
                    ahead,
                    hasRemote,
                  })),
                  Effect.catchTag("GitError", () =>
                    Effect.succeed({
                      name: branch,
                      current: branch === currentBranch,
                      ahead: 0,
                      hasRemote: true,
                    }),
                  ),
                ),
              { concurrency: 5 },
            );

      if (json) {
        const stack =
          result !== null
            ? {
                name: result.name,
                position: result.stack.branches.indexOf(currentBranch) + 1,
                total: result.stack.branches.length,
                branches: branchStatuses,
              }
            : null;
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ branch: currentBranch, clean, stack }, null, 2));
        return;
      }

      const lines: string[] = [];
      lines.push(`Branch: ${yield* stdout.bold(currentBranch)}`);
      lines.push(
        `Working tree: ${clean ? yield* stdout.green("clean") : yield* stdout.yellow("dirty")}`,
      );

      if (result !== null) {
        const { branches } = result.stack;
        const idx = branches.indexOf(currentBranch);
        const stackName = yield* stdout.bold(result.name);
        const position = yield* stdout.dim(`(${idx + 1} of ${branches.length})`);
        lines.push(`Stack: ${stackName} ${position}`);
        lines.push("");
        for (const b of branchStatuses) {
          const marker = b.current ? yield* stdout.cyan("●") : yield* stdout.dim("○");
          const name = b.current ? yield* stdout.bold(b.name) : b.name;
          const suffix = !b.hasRemote
            ? " " + (yield* stdout.yellow("(no remote)"))
            : b.ahead > 0
              ? " " + (yield* stdout.yellow(`↑${b.ahead}`))
              : "";
          lines.push(`  ${marker} ${name}${suffix}`);
        }
      } else {
        lines.push(yield* stdout.dim("Not in a stack. Run 'stacked create <name>' to start one."));
      }

      yield* Console.log(lines.join("\n"));
    }),
  ),
);
