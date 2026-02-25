import { Argument, Command } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";

const stackNameArg = Argument.string("stack").pipe(Argument.optional);

export const list = Command.make("list", { stackName: stackNameArg }).pipe(
  Command.withDescription("Show stack branches (defaults to current stack)"),
  Command.withHandler(({ stackName }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const data = yield* stacks.load();
      const trunk = data.trunk;

      let targetStackName: string | null = null;
      let targetStack: { readonly branches: readonly string[] } | null = null;

      if (Option.isSome(stackName)) {
        const s = data.stacks[stackName.value];
        if (s === undefined) {
          yield* Console.error(`Stack "${stackName.value}" not found`);
          return;
        }
        targetStackName = stackName.value;
        targetStack = s;
      } else {
        for (const [name, stack] of Object.entries(data.stacks)) {
          if (stack.branches.includes(currentBranch)) {
            targetStackName = name;
            targetStack = stack;
            break;
          }
        }
      }

      if (targetStackName === null || targetStack === null) {
        yield* Console.log("Not on a stacked branch");
        return;
      }

      const lines: string[] = [];

      lines.push(`Stack: ${targetStackName}`);
      lines.push(`Trunk: ${trunk}`);
      lines.push("");

      for (let i = targetStack.branches.length - 1; i >= 0; i--) {
        const branch = targetStack.branches[i];
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
