import type { ServiceMap } from "effect";
import { Effect } from "effect";
import type { GitHubService } from "../../services/GitHub.js";

const STACKED_MARKER_START = "<!-- stacked -->";
const STACKED_MARKER_END = "<!-- /stacked -->";

type PullRequest = {
  number: number;
  url: string;
  state: string;
  body?: string | null;
} | null;

type GitHubApi = ServiceMap.Service.Shape<typeof GitHubService>;

export const generateStackMetadata = (
  branches: readonly string[],
  prMap: Map<string, PullRequest>,
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

export const composePRBody = (userBody: string | undefined, metadata: string): string => {
  if (userBody !== undefined) {
    return `${userBody}\n\n---\n\n${metadata}`;
  }
  return metadata;
};

export const updatePRBody = (
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

export const refreshStackedPRBodies = ({
  branches,
  stackName,
  gh,
  initialPrMap,
  shouldUpdateBranch,
  getUserBody,
}: {
  branches: readonly string[];
  stackName: string;
  gh: GitHubApi;
  initialPrMap?: Map<string, PullRequest>;
  shouldUpdateBranch?: (branch: string) => boolean;
  getUserBody?: (branch: string, idx: number) => string | undefined;
}) =>
  Effect.gen(function* () {
    const prEntries = yield* Effect.forEach(
      branches,
      (branch) => {
        const existing = initialPrMap?.get(branch);
        if (existing !== undefined) {
          return Effect.succeed([branch, existing] as const);
        }
        return gh.getPR(branch).pipe(Effect.map((pr) => [branch, pr] as const));
      },
      { concurrency: 5 },
    );
    const prMap = new Map(prEntries);

    // Collect all updates, then apply in parallel
    const updates: Array<{ branch: string; body: string }> = [];
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i];
      if (branch === undefined) continue;
      if (shouldUpdateBranch !== undefined && !shouldUpdateBranch(branch)) continue;

      const existingPrData = prMap.get(branch) ?? null;
      if (existingPrData === null || existingPrData.state !== "OPEN") continue;

      const metadata = generateStackMetadata(branches, prMap, i, stackName);
      const body = updatePRBody(
        existingPrData.body ?? undefined,
        getUserBody?.(branch, i),
        metadata,
      );
      updates.push({ branch, body });
    }

    yield* Effect.forEach(updates, ({ branch, body }) => gh.updatePR({ branch, body }), {
      concurrency: 5,
    });

    return prMap;
  });
