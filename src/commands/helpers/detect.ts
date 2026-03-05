import { Config } from "effect";

export const DEFAULT_MAX_DETECT_BRANCHES = 200;

export interface LimitedBranches {
  readonly untracked: readonly string[];
  readonly skipped: number;
}

export const detectLimitConfig = Config.int("STACKED_DETECT_MAX_BRANCHES").pipe(
  Config.withDefault(DEFAULT_MAX_DETECT_BRANCHES),
  Config.orElse(() => Config.succeed(DEFAULT_MAX_DETECT_BRANCHES)),
  Config.map((value) => (value > 0 ? value : DEFAULT_MAX_DETECT_BRANCHES)),
);

export const limitUntrackedBranches = (
  untrackedAll: readonly string[],
  limit: number,
): LimitedBranches => {
  const untracked = untrackedAll.slice(0, limit);
  return { untracked, skipped: untrackedAll.length - untracked.length };
};
