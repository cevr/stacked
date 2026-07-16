import { BunServices } from "@effect/platform-bun";
import { describe, expect, it } from "effect-bun-test";
import { test } from "bun:test";
import { ConfigProvider, Effect, FileSystem, Layer, Option, Path } from "effect";
import { GitService } from "../../src/services/Git.js";
import { normalizeRemoteUrl, RepositoryStore } from "../../src/services/RepositoryStore.js";
import { StackService } from "../../src/services/Stack.js";

describe("RepositoryStore", () => {
  test("normalizes SSH and HTTPS GitHub remotes to one identity", () => {
    expect(normalizeRemoteUrl("git@github.com:Cevr/Stacked.git")).toBe("github.com/cevr/stacked");
    expect(normalizeRemoteUrl("https://github.com/cevr/stacked.git")).toBe(
      "github.com/cevr/stacked",
    );
  });

  it.scoped("shares one repository record across clones with equivalent remotes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "stacked-store-" });

      const makeLayer = (clone: string, remote: string) =>
        StackService.layerWithStore.pipe(
          Layer.provideMerge(RepositoryStore.layer),
          Layer.provide(
            GitService.layerTest({
              remoteUrl: () => Effect.succeed(Option.some(remote)),
              commonGitDir: () => Effect.succeed(path.join(root, clone, ".git")),
              absoluteGitDir: () => Effect.succeed(path.join(root, clone, ".git")),
              repositoryRoot: () => Effect.succeed(path.join(root, clone)),
            }),
          ),
        );

      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          STACKED_STATE_HOME: path.join(root, "state"),
          HOME: root,
        }),
      );
      const first = yield* Effect.gen(function* () {
        const store = yield* RepositoryStore;
        const stacks = yield* StackService;
        yield* stacks.createStack("feat-a", ["feat-a", "feat-b"]);
        yield* stacks.updateSyncedOnto("feat-b", "first-clone-parent");
        return store.location.repositoryId;
      }).pipe(
        Effect.provide(makeLayer("first", "git@github.com:Cevr/Stacked.git")),
        Effect.provide(configLayer),
      );
      const second = yield* Effect.gen(function* () {
        const store = yield* RepositoryStore;
        const stacks = yield* StackService;
        return {
          id: store.location.repositoryId,
          stack: yield* stacks.getStack("feat-a"),
          syncedOnto: yield* stacks.getSyncedOnto("feat-b"),
          globalText: Option.getOrNull(yield* store.loadGlobal()),
        };
      }).pipe(
        Effect.provide(makeLayer("second", "https://github.com/cevr/stacked.git")),
        Effect.provide(configLayer),
      );

      expect(second.id).toBe(first);
      expect(second.stack?.branches).toEqual(["feat-a", "feat-b"]);
      expect(second.syncedOnto).toBeNull();
      expect(second.globalText).not.toContain("syncedOnto");
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("rejects stale concurrent writes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "stacked-cas-" });
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({ STACKED_STATE_HOME: path.join(root, "state"), HOME: root }),
      );
      const makeLayer = (clone: string) =>
        RepositoryStore.layer.pipe(
          Layer.provide(
            GitService.layerTest({
              remoteUrl: () => Effect.succeed(Option.some("git@github.com:cevr/stacked.git")),
              commonGitDir: () => Effect.succeed(path.join(root, "shared", ".git")),
              absoluteGitDir: () =>
                Effect.succeed(path.join(root, "shared", ".git", "worktrees", clone)),
              repositoryRoot: () => Effect.succeed(path.join(root, clone)),
            }),
          ),
        );
      const getStore = (clone: string) =>
        Effect.gen(function* () {
          return yield* RepositoryStore;
        }).pipe(Effect.provide(makeLayer(clone)), Effect.provide(configLayer));
      const first = yield* getStore("first");
      const second = yield* getStore("second");
      const expected = yield* first.loadGlobal();

      yield* first.saveGlobal("first\n", expected);
      const error = yield* second.saveGlobal("second\n", expected).pipe(Effect.flip);
      const checkoutExpected = yield* first.loadCheckout();
      yield* first.saveCheckout("first-checkout\n", checkoutExpected);
      const checkoutError = yield* second
        .saveCheckout("second-checkout\n", checkoutExpected)
        .pipe(Effect.flip);

      expect(error.message).toContain("changed concurrently");
      expect(checkoutError.message).toContain("changed concurrently");
      expect(Option.getOrNull(yield* first.loadGlobal())).toBe("first\n");

      const pairGlobal = yield* first.loadGlobal();
      const pairCheckout = yield* first.loadCheckout();
      yield* first.saveCheckout("newer-checkout\n", pairCheckout);
      const pairError = yield* second
        .savePair("pair-global\n", pairGlobal, "pair-checkout\n", pairCheckout)
        .pipe(Effect.flip);

      expect(pairError.message).toContain("changed concurrently");
      expect(Option.getOrNull(yield* first.loadGlobal())).toBe("first\n");
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("does not carry topology across an origin change", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "stacked-origin-" });
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({ STACKED_STATE_HOME: path.join(root, "state"), HOME: root }),
      );
      const getId = (clone: string, remote: string) =>
        Effect.gen(function* () {
          const store = yield* RepositoryStore;
          return store.location.repositoryId;
        }).pipe(
          Effect.provide(
            RepositoryStore.layer.pipe(
              Layer.provide(
                GitService.layerTest({
                  remoteUrl: () => Effect.succeed(Option.some(remote)),
                  commonGitDir: () => Effect.succeed(path.join(root, clone, ".git")),
                  absoluteGitDir: () => Effect.succeed(path.join(root, clone, ".git")),
                  repositoryRoot: () => Effect.succeed(path.join(root, clone)),
                }),
              ),
            ),
          ),
          Effect.provide(configLayer),
        );

      const original = yield* getId("checkout", "git@github.com:acme/original.git");
      const rebound = yield* getId("checkout", "git@github.com:acme/rebound.git");
      const secondClone = yield* getId("second", "https://github.com/acme/rebound.git");
      const firstRelative = yield* getId("one/checkout", "../origin.git");
      const secondRelative = yield* getId("two/checkout", "../origin.git");

      expect(rebound).not.toBe(original);
      expect(secondClone).toBe(rebound);
      expect(firstRelative).not.toBe(secondRelative);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.scoped("reclaims an abandoned repository lock", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "stacked-lock-" });
      const state = path.join(root, "state");
      const store = yield* Effect.gen(function* () {
        return yield* RepositoryStore;
      }).pipe(
        Effect.provide(
          RepositoryStore.layer.pipe(
            Layer.provide(
              GitService.layerTest({
                remoteUrl: () => Effect.succeed(Option.some("git@github.com:cevr/stacked.git")),
                commonGitDir: () => Effect.succeed(path.join(root, "clone", ".git")),
                absoluteGitDir: () => Effect.succeed(path.join(root, "clone", ".git")),
                repositoryRoot: () => Effect.succeed(path.join(root, "clone")),
              }),
            ),
          ),
        ),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ STACKED_STATE_HOME: state, HOME: root }),
          ),
        ),
      );
      const lock = path.join(state, "locks", `${store.location.repositoryId}.lock`);
      yield* fs.makeDirectory(lock, { recursive: true });
      yield* fs.writeFileString(path.join(lock, "owner"), "orphaned\n-1000000000000\n");

      yield* store.saveGlobal("recovered\n", Option.none());

      expect(Option.getOrNull(yield* store.loadGlobal())).toBe("recovered\n");
      expect(yield* fs.exists(`${lock}.stale-orphaned`)).toBe(true);
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
