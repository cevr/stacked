import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { GitService } from "../services/Git.js";
import { StackService } from "../services/Stack.js";
import { GitHubService } from "../services/GitHub.js";
import { StackError } from "../errors/index.js";

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
  Flag.withDescription("PR title (defaults to branch name)"),
);
const bodyFlag = Flag.string("body").pipe(
  Flag.optional,
  Flag.withAlias("b"),
  Flag.withDescription("PR body/description"),
);

interface SubmitResult {
  branch: string;
  number: number;
  url: string;
  action: "created" | "updated" | "unchanged";
}

const STACKED_MARKER_START = "<!-- stacked -->";
const STACKED_MARKER_END = "<!-- /stacked -->";

const generateStackMetadata = (
  branches: readonly string[],
  prMap: Map<string, { number: number; url: string; state: string } | null>,
  currentIdx: number,
  stackName: string,
): string => {
  const rows = branches.map((branch, i) => {
    const pr = prMap.get(branch) ?? null;
    const isCurrent = i === currentIdx;
    const branchCol = isCurrent ? `**\`${branch}\`**` : `\`${branch}\``;
    const numCol = i + 1;
    const numStr = isCurrent ? `**${numCol}**` : `${numCol}`;

    let prCol: string;
    if (pr === null) {
      prCol = "—";
    } else if (pr.state === "MERGED") {
      prCol = `[#${pr.number}](${pr.url}) ✅`;
    } else if (isCurrent) {
      prCol = `**#${pr.number} ← you are here**`;
    } else {
      prCol = `[#${pr.number}](${pr.url})`;
    }

    return `| ${numStr} | ${branchCol} | ${prCol} |`;
  });

  return [
    STACKED_MARKER_START,
    `**Stack: \`${stackName}\`** (${currentIdx + 1} of ${branches.length})`,
    "",
    "| # | Branch | PR |",
    "|---|--------|----|",
    ...rows,
    STACKED_MARKER_END,
  ].join("\n");
};

const composePRBody = (userBody: string | undefined, metadata: string): string => {
  if (userBody !== undefined) {
    return `${userBody}\n\n---\n\n${metadata}`;
  }
  return metadata;
};

const updatePRBody = (
  existingBody: string | undefined,
  userBody: string | undefined,
  metadata: string,
): string => {
  if (userBody !== undefined) {
    return composePRBody(userBody, metadata);
  }

  if (existingBody !== undefined) {
    const startIdx = existingBody.indexOf(STACKED_MARKER_START);
    if (startIdx !== -1) {
      const prefix = existingBody.substring(0, startIdx).replace(/\n*---\n*$/, "");
      if (prefix.trim().length > 0) {
        return `${prefix.trim()}\n\n---\n\n${metadata}`;
      }
      return metadata;
    }
    return `${existingBody.trim()}\n\n---\n\n${metadata}`;
  }

  return metadata;
};

export const submit = Command.make("submit", {
  draft: draftFlag,
  noForce: noForceFlag,
  dryRun: dryRunFlag,
  title: titleFlag,
  body: bodyFlag,
}).pipe(
  Command.withDescription("Push all stack branches and create/update PRs via gh"),
  Command.withHandler(({ draft, noForce, dryRun, title: titleOpt, body: bodyOpt }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;
      const gh = yield* GitHubService;

      const ghInstalled = yield* gh.isGhInstalled();
      if (!ghInstalled) {
        return yield* new StackError({
          message: "gh CLI is not installed. Install it from https://cli.github.com",
        });
      }

      const result = yield* stacks.currentStack();
      if (result === null) {
        return yield* new StackError({
          message:
            "Not on a stacked branch. Run 'stacked list' to see your stacks, or 'stacked create <name>' to start one.",
        });
      }

      const trunk = yield* stacks.getTrunk();
      const { branches } = result.stack;
      const userTitle = Option.isSome(titleOpt) ? titleOpt.value : undefined;
      const userBody = Option.isSome(bodyOpt) ? bodyOpt.value : undefined;

      const results: SubmitResult[] = [];
      const prMap = new Map<string, { number: number; url: string; state: string } | null>();

      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        if (branch === undefined) continue;
        const base = i === 0 ? trunk : (branches[i - 1] ?? trunk);

        if (dryRun) {
          yield* Console.error(`Would push ${branch} and create/update PR (base: ${base})`);
          continue;
        }

        yield* Console.error(`Pushing ${branch}...`);
        yield* git.push(branch, { force: !noForce });

        const existingPR = yield* gh.getPR(branch);
        prMap.set(branch, existingPR);

        if (existingPR !== null) {
          if (existingPR.base !== base) {
            yield* Console.error(`Updating PR #${existingPR.number} base to ${base}`);
            yield* gh.updatePR({ branch, base });
            results.push({
              branch,
              number: existingPR.number,
              url: existingPR.url,
              action: "updated",
            });
          } else {
            yield* Console.error(`PR #${existingPR.number} already exists: ${existingPR.url}`);
            results.push({
              branch,
              number: existingPR.number,
              url: existingPR.url,
              action: "unchanged",
            });
          }
        } else {
          const title =
            userTitle ?? branch.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
          const metadata = generateStackMetadata(branches, prMap, i, result.name);
          const body = composePRBody(userBody, metadata);

          const pr = yield* gh.createPR({
            head: branch,
            base,
            title,
            body,
            draft,
          });
          prMap.set(branch, { number: pr.number, url: pr.url, state: "OPEN" });
          yield* Console.error(`Created PR #${pr.number}: ${pr.url}`);
          results.push({
            branch,
            number: pr.number,
            url: pr.url,
            action: "created",
          });
        }
      }

      if (dryRun) return;

      // Update existing PRs with stack metadata
      for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];
        if (branch === undefined) continue;

        const entry = results.find((x) => x.branch === branch);
        if (entry === undefined || entry.action === "created") continue;

        const metadata = generateStackMetadata(branches, prMap, i, result.name);
        const body = updatePRBody(undefined, userBody, metadata);
        yield* gh.updatePR({ branch, body });
      }

      // Print structured output to stdout
      for (const r of results) {
        yield* Console.log(`${r.branch} #${r.number} ${r.url} ${r.action}`);
      }
    }),
  ),
);
