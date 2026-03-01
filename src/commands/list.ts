import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { GitHubService } from "../services/GitHub.js";
import { StackService } from "../services/Stack.js";
import { StackError } from "../errors/index.js";
import { bold, dim, green, cyan } from "../ui.js";

const stackNameArg = Argument.string("stack").pipe(Argument.optional);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const list = Command.make("list", { stackName: stackNameArg, json: jsonFlag }).pipe(
  Command.withDescription("Show stack branches (defaults to current stack)"),
  Command.withExamples([
    { command: "stacked list", description: "Show branches in current stack" },
    { command: "stacked list my-stack --json", description: "JSON output for a specific stack" },
  ]),
  Command.withHandler(({ stackName, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const gh = yield* GitHubService;
      const stacks = yield* StackService;

      const currentBranch = yield* git.currentBranch();
      const data = yield* stacks.load();
      const trunk = data.trunk;

      let targetStackName: string | null = null;
      let targetStack: { readonly branches: readonly string[] } | null = null;

      if (Option.isSome(stackName)) {
        const s = data.stacks[stackName.value];
        if (s === undefined) {
          return yield* new StackError({ message: `Stack "${stackName.value}" not found` });
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
        return yield* new StackError({
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      const prStatuses = yield* Effect.forEach(
        targetStack.branches as readonly string[],
        (branch) =>
          gh.getPR(branch).pipe(
            Effect.catchTag("GitHubError", () => Effect.succeed(null)),
            Effect.map((pr) => [branch, pr] as const),
          ),
        { concurrency: 5 },
      );
      const prMap = new Map(prStatuses);

      if (json) {
        const branches = [...targetStack.branches].map((branch) => {
          const pr = prMap.get(branch) ?? null;
          return {
            name: branch,
            current: branch === currentBranch,
            pr: pr !== null ? { number: pr.number, url: pr.url, state: pr.state } : null,
          };
        });
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ stack: targetStackName, trunk, branches }, null, 2));
        return;
      }

      const lines: string[] = [];

      lines.push(`Stack: ${bold(targetStackName)}`);
      lines.push(`Trunk: ${dim(trunk)}`);
      lines.push("");

      for (let i = targetStack.branches.length - 1; i >= 0; i--) {
        const branch = targetStack.branches[i];
        if (branch === undefined) continue;
        const isCurrent = branch === currentBranch;
        const marker = isCurrent ? green("* ") : "  ";
        const prefix = dim(i === 0 ? "└─" : "├─");
        const name = isCurrent ? bold(branch) : branch;

        const pr = prMap.get(branch) ?? null;
        const status =
          pr === null
            ? ""
            : pr.state === "MERGED"
              ? green(" [merged]")
              : pr.state === "CLOSED"
                ? dim(" [closed]")
                : cyan(` [#${pr.number}]`);

        lines.push(`${marker}${prefix} ${name}${status}`);
      }

      yield* Console.log(lines.join("\n"));
    }),
  ),
);
