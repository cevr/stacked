import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { bold, green, yellow, dim } from "../ui.js";

export const status = Command.make("status").pipe(
  Command.withDescription("Show current branch, stack position, and working tree state"),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const clean = yield* git.isClean();
      const result = yield* stacks.currentStack();

      const lines: string[] = [];
      lines.push(`Branch: ${bold(currentBranch)}`);
      lines.push(`Working tree: ${clean ? green("clean") : yellow("dirty")}`);

      if (result !== null) {
        const { branches } = result.stack;
        const idx = branches.indexOf(currentBranch);
        lines.push(`Stack: ${bold(result.name)} ${dim(`(${idx + 1} of ${branches.length})`)}`);
      } else {
        lines.push(dim("Not in a stack. Run 'stacked create <name>' to start one."));
      }

      yield* Console.log(lines.join("\n"));
    }),
  ),
);
