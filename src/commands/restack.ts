import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

export const restack = Command.make("restack").pipe(
  Command.withDescription("Rebase children after mid-stack changes"),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const result = yield* stacks.currentStack();
      if (result === null) {
        yield* Console.error("Not on a stacked branch");
        return;
      }

      const { branches } = result.stack;
      const idx = branches.indexOf(currentBranch);
      if (idx === -1) {
        yield* Console.error("Current branch not found in stack");
        return;
      }

      for (let i = idx + 1; i < branches.length; i++) {
        const branch = branches[i];
        if (branch === undefined) continue;
        const base = branches[i - 1] ?? currentBranch;
        yield* Console.log(`Rebasing ${branch} onto ${base}...`);
        yield* git.checkout(branch);
        yield* git.rebase(base);
      }

      yield* git.checkout(currentBranch);
      yield* Console.log("Stack restacked");
    }),
  ),
);
