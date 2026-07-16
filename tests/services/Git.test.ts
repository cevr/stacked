import { describe, expect, it } from "effect-bun-test";
import { Effect, Option } from "effect";
import { GitService } from "../../src/services/Git.js";

describe("GitService", () => {
  it.effect("provides repository identity defaults in the test layer", () =>
    Effect.gen(function* () {
      const git = yield* GitService;

      expect(Option.isNone(yield* git.remoteUrl())).toBe(true);
      expect(yield* git.commonGitDir()).toBe("/repo/.git");
      expect(yield* git.absoluteGitDir()).toBe("/repo/.git");
      expect(yield* git.repositoryRoot()).toBe("/repo");
    }).pipe(Effect.provide(GitService.layerTest())),
  );

  it.effect("allows repository identity defaults to be overridden", () =>
    Effect.gen(function* () {
      const git = yield* GitService;

      expect(Option.getOrUndefined(yield* git.remoteUrl())).toBe("git@example.com:org/repo.git");
      expect(yield* git.commonGitDir()).toBe("/worktree/.git");
      expect(yield* git.absoluteGitDir()).toBe("/worktree/.git/worktrees/feature");
      expect(yield* git.repositoryRoot()).toBe("/worktree/feature");
    }).pipe(
      Effect.provide(
        GitService.layerTest({
          remoteUrl: () => Effect.succeed(Option.some("git@example.com:org/repo.git")),
          commonGitDir: () => Effect.succeed("/worktree/.git"),
          absoluteGitDir: () => Effect.succeed("/worktree/.git/worktrees/feature"),
          repositoryRoot: () => Effect.succeed("/worktree/feature"),
        }),
      ),
    ),
  );
});
