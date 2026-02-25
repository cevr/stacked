import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

export const list = Command.make("list").pipe(
  Command.withDescription("Show current stack with branch status"),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const data = yield* stacks.load();
      const trunk = data.trunk;

      let currentStackName: string | null = null;
      for (const [name, stack] of Object.entries(data.stacks)) {
        if (stack.branches.includes(currentBranch)) {
          currentStackName = name;
          break;
        }
      }

      if (currentStackName === null) {
        yield* Console.log("Not on a stacked branch");
        return;
      }

      const stack = data.stacks[currentStackName];
      if (stack === undefined) return;
      const lines: string[] = [];

      lines.push(`Stack: ${currentStackName}`);
      lines.push(`Trunk: ${trunk}`);
      lines.push("");

      for (let i = stack.branches.length - 1; i >= 0; i--) {
        const branch = stack.branches[i];
        if (branch === undefined) continue;
        const isCurrent = branch === currentBranch;
        const marker = isCurrent ? "* " : "  ";
        const prefix = i === 0 ? "└─" : "├─";
        lines.push(`${marker}${prefix} ${branch}`);
      }

      yield* Console.log(lines.join("\n"));
    }),
  ),
);
