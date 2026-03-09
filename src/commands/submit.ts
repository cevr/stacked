import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { GitHubService } from "../services/GitHub.js";
import { ErrorCode, StackError } from "../errors/index.js";
import {
  composePRBody,
  generateStackMetadata,
  refreshStackedPRBodies,
} from "./helpers/pr-metadata.js";
import { withSpinner, success } from "../ui.js";

const draftFlag = Flag.boolean("draft").pipe(
  Flag.withAlias("d"),
  Flag.withDescription("Create PRs as drafts"),
);
const noForceFlag = Flag.boolean("no-force").pipe(
  Flag.withDescription("Disable force-push (force-with-lease is on by default)"),
);
const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Show what would happen without making changes"),
);
const titleFlag = Flag.string("title").pipe(
  Flag.optional,
  Flag.withAlias("t"),
  Flag.withDescription(
    "PR title (defaults to branch name). Comma-delimited for per-branch titles.",
  ),
);
const bodyFlag = Flag.string("body").pipe(
  Flag.optional,
  Flag.withAlias("b"),
  Flag.withDescription("PR body/description. Comma-delimited for per-branch bodies."),
);
const onlyFlag = Flag.boolean("only").pipe(Flag.withDescription("Only submit the current branch"));

interface SubmitResult {
  branch: string;
  base: string;
  number?: number;
  url?: string;
  action: "created" | "updated" | "unchanged" | "would-create" | "would-update" | "would-unchanged";
}

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const submit = Command.make("submit", {
  draft: draftFlag,
  noForce: noForceFlag,
  dryRun: dryRunFlag,
  title: titleFlag,
  body: bodyFlag,
  only: onlyFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Push all stack branches and create/update PRs via gh"),
  Command.withExamples([
    { command: "stacked submit", description: "Push and create/update PRs for all branches" },
    { command: "stacked submit --draft", description: "Create PRs as drafts" },
    { command: "stacked submit --only", description: "Submit only the current branch" },
    {
      command: 'stacked submit --title "Add auth" --body "Implements OAuth2"',
      description: "With PR title and body",
    },
  ]),
  Command.withHandler(({ draft, noForce, dryRun, title: titleOpt, body: bodyOpt, only, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;
      const gh = yield* GitHubService;

      const ghInstalled = yield* gh.isGhInstalled();
      if (!ghInstalled) {
        return yield* new StackError({
          code: ErrorCode.GH_NOT_INSTALLED,
          message: "gh CLI is not installed. Install it from https://cli.github.com",
        });
      }

      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({
          code: ErrorCode.NOT_IN_STACK,
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      const trunk = yield* stacks.getTrunk();
      const currentBranch = yield* git.currentBranch();
      const { branches } = result.stack;
      const data = yield* stacks.load();
      const mergedSet = new Set(data.mergedBranches);

      // Compute the effective base for a branch at index i, skipping merged branches
      const effectiveBase = (i: number): string => {
        for (let j = i - 1; j >= 0; j--) {
          const candidate = branches[j];
          if (candidate !== undefined && !mergedSet.has(candidate)) return candidate;
        }
        return trunk;
      };

      const rawTitle = Option.isSome(titleOpt) ? titleOpt.value : undefined;
      const rawBody = Option.isSome(bodyOpt) ? bodyOpt.value : undefined;

      // Parse comma-delimited titles/bodies for per-branch support
      const titles =
        rawTitle !== undefined && rawTitle.includes(",")
          ? rawTitle.split(",").map((s) => s.trim())
          : undefined;
      const bodies =
        rawBody !== undefined && rawBody.includes(",")
          ? rawBody.split(",").map((s) => s.trim())
          : undefined;

      if (titles !== undefined && titles.length !== branches.length) {
        return yield* new StackError({
          code: ErrorCode.USAGE_ERROR,
          message: `--title has ${titles.length} values but stack has ${branches.length} branches`,
        });
      }
      if (bodies !== undefined && bodies.length !== branches.length) {
        return yield* new StackError({
          code: ErrorCode.USAGE_ERROR,
          message: `--body has ${bodies.length} values but stack has ${branches.length} branches`,
        });
      }

      const getTitleForBranch = (branch: string, idx: number): string | undefined => {
        if (titles !== undefined) return titles[idx];
        // Single --title: apply only to current branch
        if (rawTitle !== undefined && branch === currentBranch) return rawTitle;
        return undefined;
      };

      const getBodyForBranch = (branch: string, idx: number): string | undefined => {
        if (bodies !== undefined) return bodies[idx];
        // Single --body: apply only to current branch
        if (rawBody !== undefined && branch === currentBranch) return rawBody;
        return undefined;
      };

      const results: SubmitResult[] = [];
      const prMap = new Map<
        string,
        { number: number; url: string; state: string; base: string; body?: string | null } | null
      >();

      // Pre-fetch all PR statuses in parallel
      const activeBranches = only ? branches.filter((b) => b === currentBranch) : [...branches];
      const prResults = yield* Effect.forEach(
        activeBranches,
        (branch) =>
          gh.getPR(branch).pipe(
            Effect.map((pr) => [branch, pr] as const),
            Effect.catchTag("GitHubError", () => Effect.succeed([branch, null] as const)),
          ),
        { concurrency: 5 },
      );
      for (const [branch, pr] of prResults) {
        prMap.set(branch, pr);
      }

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        if (branch === undefined) continue;
        const base = effectiveBase(i);

        // --only: skip branches that aren't current
        if (only && branch !== currentBranch) continue;

        if (dryRun) {
          const existingPR = prMap.get(branch) ?? null;
          const action =
            existingPR === null
              ? "would-create"
              : existingPR.base !== base
                ? "would-update"
                : "would-unchanged";
          results.push({
            branch,
            base,
            number: existingPR?.number,
            url: existingPR?.url,
            action,
          });
          if (!json) {
            yield* Console.error(`Would push ${branch} and create/update PR (base: ${base})`);
          }
          continue;
        }

        yield* withSpinner(`Pushing ${branch}`, git.push(branch, { force: !noForce }));

        const existingPR = prMap.get(branch) ?? null;

        if (existingPR !== null) {
          if (existingPR.base !== base) {
            yield* Console.error(`Updating PR #${existingPR.number} base to ${base}`);
            yield* gh.updatePR({ branch, base });
            results.push({
              branch,
              base,
              number: existingPR.number,
              url: existingPR.url,
              action: "updated",
            });
          } else {
            yield* Console.error(`PR #${existingPR.number} already exists: ${existingPR.url}`);
            results.push({
              branch,
              base,
              number: existingPR.number,
              url: existingPR.url,
              action: "unchanged",
            });
          }
        } else {
          const userTitle = getTitleForBranch(branch, i);
          const title =
            userTitle ?? branch.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
          const metadata = generateStackMetadata(branches, prMap, i, result.name);
          const userBody = getBodyForBranch(branch, i);
          const body = composePRBody(userBody, metadata);

          const pr = yield* gh.createPR({
            head: branch,
            base,
            title,
            body,
            draft,
          });
          prMap.set(branch, { number: pr.number, url: pr.url, state: "OPEN", base });
          yield* success(`Created PR #${pr.number}: ${pr.url}`);
          results.push({
            branch,
            base,
            number: pr.number,
            url: pr.url,
            action: "created",
          });
        }
      }

      if (dryRun) {
        if (json) {
          // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
          yield* Console.log(JSON.stringify({ results }, null, 2));
        }
        return;
      }

      // Update all processed PRs with complete stack metadata.
      // This includes newly created PRs so placeholders get replaced in one submit run.
      yield* refreshStackedPRBodies({
        branches,
        stackName: result.name,
        gh,
        initialPrMap: prMap,
        shouldUpdateBranch: (branch) =>
          (!only || branch === currentBranch) && results.some((entry) => entry.branch === branch),
        getUserBody: getBodyForBranch,
      });
      yield* stacks.unmarkMergedBranches(branches);

      // Print structured output to stdout
      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ results }, null, 2));
      } else {
        for (const r of results) {
          yield* Console.log(`${r.branch} #${r.number} ${r.url} ${r.action}`);
        }
      }
    }),
  ),
);
