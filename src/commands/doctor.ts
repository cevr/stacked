import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { success, warn } from "../ui.js";

const fixFlag = Flag.boolean("fix").pipe(Flag.withDescription("Auto-fix issues where possible"));
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

interface Finding {
  type: "stale_branch" | "missing_trunk" | "duplicate_branch" | "parse_error";
  message: string;
  fixed: boolean;
}

export const doctor = Command.make("doctor", { fix: fixFlag, json: jsonFlag }).pipe(
  Command.withDescription("Check stack metadata for issues and optionally fix them"),
  Command.withExamples([
    { command: "stacked doctor", description: "Check for metadata drift" },
    { command: "stacked doctor --fix", description: "Auto-fix detected issues" },
  ]),
  Command.withHandler(({ fix, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;

      const data = yield* stacks.load();
      const findings: Finding[] = [];
      const stackEntries = yield* stacks.listStacks().pipe(
        Effect.catchTag("StackError", (error) =>
          Effect.sync(() => {
            findings.push({ type: "parse_error", message: error.message, fixed: false });
            return [] as const;
          }),
        ),
      );

      // Check 1: trunk branch exists
      const trunkExists = yield* git
        .branchExists(data.trunk)
        .pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));
      if (!trunkExists) {
        if (fix) {
          const candidate = yield* stacks.detectTrunkCandidate();
          if (Option.isSome(candidate)) {
            yield* stacks.setTrunk(candidate.value);
            findings.push({
              type: "missing_trunk",
              message: `Trunk "${data.trunk}" not found, set to "${candidate.value}"`,
              fixed: true,
            });
          } else {
            findings.push({
              type: "missing_trunk",
              message: `Trunk branch "${data.trunk}" does not exist and no replacement could be auto-detected`,
              fixed: false,
            });
          }
        } else {
          findings.push({
            type: "missing_trunk",
            message: `Trunk branch "${data.trunk}" does not exist`,
            fixed: false,
          });
        }
      }

      // Check 2: all tracked branches exist in git
      const allGitBranches = yield* git
        .listBranches()
        .pipe(Effect.catchTag("GitError", () => Effect.succeed([] as string[])));
      const gitBranchSet = new Set(allGitBranches);

      for (const { name: stackName, stack } of stackEntries) {
        for (const branch of stack.branches) {
          if (!gitBranchSet.has(branch)) {
            if (fix) {
              yield* stacks.removeBranch(branch);
              findings.push({
                type: "stale_branch",
                message: `Removed stale branch "${branch}" from stack "${stackName}"`,
                fixed: true,
              });
            } else {
              findings.push({
                type: "stale_branch",
                message: `Branch "${branch}" in stack "${stackName}" does not exist in git`,
                fixed: false,
              });
            }
          }
        }
      }

      // Check 3: no branches in multiple stacks
      const branchToStacks = new Map<string, string[]>();
      for (const [branch, record] of Object.entries(data.branches)) {
        const existing = branchToStacks.get(branch) ?? [];
        existing.push(record.stack);
        branchToStacks.set(branch, existing);
      }
      for (const [branch, stackNames] of branchToStacks) {
        if (stackNames.length > 1) {
          findings.push({
            type: "duplicate_branch",
            message: `Branch "${branch}" appears in multiple stacks: ${stackNames.join(", ")}`,
            fixed: false,
          });
        }
      }

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ findings }, null, 2));
      } else if (findings.length === 0) {
        yield* success("No issues found");
      } else {
        for (const f of findings) {
          if (f.fixed) {
            yield* success(f.message);
          } else {
            yield* warn(f.message);
          }
        }
        const fixable = findings.filter((f) => !f.fixed).length;
        if (fixable > 0 && !fix) {
          yield* Console.error(`\nRun 'stacked doctor --fix' to auto-fix ${fixable} issue(s)`);
        }
      }
    }),
  ),
);
