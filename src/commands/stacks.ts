import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

export const stacks = Command.make("stacks").pipe(
  Command.withDescription("List all stacks in the repo"),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stackService = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const data = yield* stackService.load();

      const entries = Object.entries(data.stacks);
      if (entries.length === 0) {
        yield* Console.log("No stacks");
        return;
      }

      const lines: string[] = [];
      for (const [name, stack] of Object.entries(data.stacks)) {
        const isCurrent = stack.branches.includes(currentBranch);
        const marker = isCurrent ? "* " : "  ";
        const count = stack.branches.length;
        lines.push(`${marker}${name} (${count} branch${count === 1 ? "" : "es"})`);
      }

      yield* Console.log(lines.join("\n"));
    }),
  ),
);
