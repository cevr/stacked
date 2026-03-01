import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";
import { confirm } from "../ui.js";

const nameArg = Argument.string("name").pipe(Argument.withDescription("Branch name to delete"));
const forceFlag = Flag.boolean("force").pipe(
  Flag.withAlias("f"),
  Flag.withDescription("Delete even if branch has children in the stack"),
);
const keepRemoteFlag = Flag.boolean("keep-remote").pipe(
  Flag.withDescription("Don't delete the remote branch"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const deleteCmd = Command.make("delete", {
  name: nameArg,
  force: forceFlag,
  keepRemote: keepRemoteFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Remove branch from stack and delete git branch"),
  Command.withExamples([
    { command: "stacked delete feat-old", description: "Delete a leaf branch" },
    { command: "stacked delete feat-mid --force", description: "Force delete a mid-stack branch" },
  ]),
  Command.withHandler(({ name, force, keepRemote, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const trunk = yield* stacks.getTrunk();

      const result = yield* stacks.findBranchStack(name);
      if (result === null) {
        return yield* new StackError({ message: `Branch "${name}" not found in any stack` });
      }
      const { name: stackName, stack } = result;
      const idx = stack.branches.indexOf(name);

      if (idx < stack.branches.length - 1 && !force) {
        return yield* new StackError({
          message: `Branch "${name}" has children. Use --force to delete anyway.`,
        });
      }

      const confirmed = yield* confirm(
        `Delete branch "${name}"${keepRemote ? "" : " (local + remote)"}?`,
      );
      if (!confirmed) {
        yield* Console.error("Aborted");
        return;
      }

      if (currentBranch === name) {
        const clean = yield* git.isClean();
        if (!clean) {
          return yield* new StackError({
            message:
              "Working tree has uncommitted changes. Commit or stash before deleting the current branch.",
          });
        }
        const parent = idx === 0 ? trunk : (stack.branches[idx - 1] ?? trunk);
        yield* git.checkout(parent);
      }

      const hadChildren = idx < stack.branches.length - 1;

      yield* git.deleteBranch(name, force);
      yield* stacks.removeBranch(stackName, name);

      if (!keepRemote) {
        yield* git.deleteRemoteBranch(name).pipe(Effect.catchTag("GitError", () => Effect.void));
      }

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ deleted: name, hadChildren }, null, 2));
      } else {
        yield* Console.error(`Deleted ${name}`);
        if (hadChildren) {
          yield* Console.error(
            "Warning: branch had children — commits unique to this branch may be lost if children don't include them. Run 'stacked sync' to rebase them onto the new parent.",
          );
        }
      }
    }),
  ),
);
