import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";

const nameArg = Argument.string("name");
const forceFlag = Flag.boolean("force").pipe(Flag.withAlias("f"));

export const deleteCmd = Command.make("delete", { name: nameArg, force: forceFlag }).pipe(
  Command.withDescription("Remove branch from stack and delete git branch"),
  Command.withHandler(({ name, force }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const data = yield* stacks.load();

      let stackName: string | null = null;
      for (const [sName, stack] of Object.entries(data.stacks)) {
        if (stack.branches.includes(name)) {
          stackName = sName;
          break;
        }
      }

      if (stackName === null) {
        return yield* new StackError({ message: `Branch "${name}" not found in any stack` });
      }

      const stack = data.stacks[stackName];
      if (stack === undefined) {
        return yield* new StackError({ message: `Stack "${stackName}" not found` });
      }
      const idx = stack.branches.indexOf(name);

      if (idx < stack.branches.length - 1 && !force) {
        return yield* new StackError({
          message: `Branch "${name}" has children. Use --force to delete anyway.`,
        });
      }

      if (currentBranch === name) {
        const parent = idx === 0 ? data.trunk : (stack.branches[idx - 1] ?? data.trunk);
        yield* git.checkout(parent);
      }

      yield* stacks.removeBranch(stackName, name);
      yield* git.deleteBranch(name, force);

      yield* Console.log(`Deleted ${name}`);
    }),
  ),
);
