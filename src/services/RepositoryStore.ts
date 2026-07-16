import {
  Brand,
  Clock,
  Config,
  Context,
  Crypto,
  Effect,
  Encoding,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Result,
  Schedule,
  Schema,
} from "effect";
import { StackError } from "../errors/index.js";
import { GitService } from "./Git.js";

export type RepositoryId = string & Brand.Brand<"RepositoryId">;
const RepositoryId = Brand.nominal<RepositoryId>();

const RepositoryEntrySchema = Schema.Struct({
  aliases: Schema.Array(Schema.String),
  checkouts: Schema.Array(Schema.String),
});

const RepositoryIndexSchema = Schema.Struct({
  version: Schema.Literal(1),
  aliases: Schema.Record(Schema.String, Schema.String),
  checkouts: Schema.Record(Schema.String, Schema.String),
  checkoutRoots: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  repositories: Schema.Record(Schema.String, RepositoryEntrySchema),
});

type RepositoryIndex = typeof RepositoryIndexSchema.Type;

export interface RepositoryLocation {
  readonly repositoryId: RepositoryId;
  readonly canonicalRemote: string | null;
  readonly stateDirectory: string;
  readonly stackFile: string;
  readonly checkoutFile: string;
  readonly commonGitDirectory: string;
  readonly absoluteGitDirectory: string;
  readonly repositoryRoot: string;
}

export interface LegacyStackFile {
  readonly path: string;
  readonly text: string;
}

const emptyIndex: RepositoryIndex = {
  version: 1,
  aliases: {},
  checkouts: {},
  checkoutRoots: {},
  repositories: {},
};

const stateDirectoryConfig = Config.all({
  explicit: Config.option(Config.string("STACKED_STATE_HOME")),
  xdg: Config.option(Config.string("XDG_STATE_HOME")),
  home: Config.string("HOME"),
});

const sortUnique = (values: readonly string[]) => [...new Set(values)].sort();

export const normalizeRemoteUrl = (input: string): string => {
  const trimmed = input.trim().replace(/\/+$/, "");
  const scpMatch = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed);
  if (scpMatch !== null && !trimmed.includes("://")) {
    const host = scpMatch[1]?.toLowerCase() ?? "";
    const rawPath = scpMatch[2] ?? "";
    const path = rawPath.replace(/^\/+/, "").replace(/\.git$/i, "");
    return `${host}/${host === "github.com" ? path.toLowerCase() : path}`;
  }

  const urlMatch = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(trimmed);
  if (urlMatch !== null) {
    const host = urlMatch[1]?.toLowerCase() ?? "";
    const rawPath = urlMatch[2] ?? "";
    const path = rawPath.replace(/^\/+/, "").replace(/\.git$/i, "");
    return `${host}/${host === "github.com" ? path.toLowerCase() : path}`;
  }

  return trimmed.replace(/\.git$/i, "");
};

const canonicalRemoteIdentity = Effect.fn("RepositoryStore.canonicalRemoteIdentity")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  repositoryRoot: string,
  input: string,
) {
  const trimmed = input.trim();
  const isScp = /^(?:[^@/]+@)?[^:/]+:.+$/.test(trimmed) && !trimmed.includes("://");
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)?.[1]?.toLowerCase();
  const isNetwork = isScp || (scheme !== undefined && scheme !== "file");
  if (isNetwork) return normalizeRemoteUrl(trimmed);

  const local = scheme === "file" ? trimmed.replace(/^file:\/\/(?:localhost)?/i, "") : trimmed;
  const absolute = path.resolve(repositoryRoot, local);
  return `file:${yield* canonicalPath(fs, absolute)}`;
});

const mapPlatformError = (action: string, path: string, error: unknown) =>
  new StackError({ message: `Failed to ${action} ${path}: ${String(error)}` });

const canonicalPath = (fs: FileSystem.FileSystem, value: string) =>
  fs.realPath(value).pipe(Effect.catchTag("PlatformError", () => Effect.succeed(value)));

const digestIdentity = Effect.fn("RepositoryStore.digestIdentity")(function* (
  crypto: Crypto.Crypto,
  identity: string,
) {
  const bytes = Result.getOrThrow(Encoding.decodeHex(Encoding.encodeHex(identity)));
  const digest = yield* crypto
    .digest("SHA-256", bytes)
    .pipe(
      Effect.mapError(
        (error) => new StackError({ message: `Failed to hash repository identity: ${error}` }),
      ),
    );
  return RepositoryId(`repo_${Encoding.encodeHex(digest).slice(0, 24)}`);
});

const atomicWrite = Effect.fn("RepositoryStore.atomicWrite")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  destination: string,
  text: string,
) {
  const directory = path.dirname(destination);
  yield* fs
    .makeDirectory(directory, { recursive: true, mode: 0o700 })
    .pipe(Effect.mapError((error) => mapPlatformError("create directory", directory, error)));
  yield* Effect.acquireUseRelease(
    fs
      .makeTempFile({ directory, prefix: ".stacked-", suffix: ".tmp" })
      .pipe(
        Effect.mapError((error) => mapPlatformError("create temporary file in", directory, error)),
      ),
    (temporary) =>
      Effect.gen(function* () {
        yield* fs
          .writeFileString(temporary, text, { mode: 0o600 })
          .pipe(Effect.mapError((error) => mapPlatformError("write", temporary, error)));
        yield* fs
          .chmod(temporary, 0o600)
          .pipe(Effect.mapError((error) => mapPlatformError("chmod", temporary, error)));
        yield* fs
          .rename(temporary, destination)
          .pipe(Effect.mapError((error) => mapPlatformError("rename", destination, error)));
      }),
    (temporary) => fs.remove(temporary, { force: true }).pipe(Effect.ignore),
  );
});

const acquireLock = Effect.fn("RepositoryStore.acquireLock")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  crypto: Crypto.Crypto,
  lockPath: string,
) {
  const directory = path.dirname(lockPath);
  yield* fs
    .makeDirectory(directory, { recursive: true, mode: 0o700 })
    .pipe(Effect.mapError((error) => mapPlatformError("create directory", directory, error)));
  const token = yield* crypto.randomUUIDv7.pipe(
    Effect.mapError((error) => mapPlatformError("create lock token for", lockPath, error)),
  );
  const startedAt = yield* Clock.currentTimeMillis;
  const candidates = path.join(directory, ".candidates");
  yield* fs
    .makeDirectory(candidates, { recursive: true, mode: 0o700 })
    .pipe(Effect.mapError((error) => mapPlatformError("create directory", candidates, error)));
  yield* Effect.acquireUseRelease(
    fs
      .makeTempDirectory({ directory: candidates, prefix: "lock-" })
      .pipe(
        Effect.mapError((error) => mapPlatformError("create lock candidate for", lockPath, error)),
      ),
    (candidate) =>
      Effect.gen(function* () {
        yield* fs
          .writeFileString(path.join(candidate, "owner"), `${token}\n${startedAt}\n`, {
            mode: 0o600,
          })
          .pipe(
            Effect.mapError((error) =>
              mapPlatformError("write lock candidate for", lockPath, error),
            ),
          );
        const create = fs.rename(candidate, lockPath);
        const reclaimStale = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const text = yield* fs.readFileString(path.join(lockPath, "owner")).pipe(Effect.option);
          const recorded = Option.flatMap(text, (value) =>
            Option.fromNullishOr(Number.parseInt(value.split("\n")[1] ?? "", 10)).pipe(
              Option.filter(Number.isFinite),
            ),
          );
          const stat = yield* fs.stat(lockPath).pipe(Effect.option);
          const modified = Option.flatMap(stat, (info) => info.mtime);
          const timestamp = Option.getOrElse(recorded, () =>
            Option.match(modified, { onNone: () => now, onSome: (value) => value.getTime() }),
          );
          if (now - timestamp <= 10 * 60 * 1_000) return;
          const observedToken = Option.match(text, {
            onNone: () => `legacy-${timestamp}`,
            onSome: (value) => value.split("\n")[0] || `legacy-${timestamp}`,
          })
            .replace(/[^a-zA-Z0-9._-]/g, "_")
            .slice(0, 128);
          // Keep the tombstone: contenders that observed the same stale incarnation
          // must fail here instead of renaming a newly acquired lock out of the way.
          yield* fs.rename(lockPath, `${lockPath}.stale-${observedToken}`);
        });
        const createOrReclaim = create.pipe(
          Effect.catchTag("PlatformError", (error) =>
            fs
              .exists(lockPath)
              .pipe(
                Effect.flatMap((exists) =>
                  exists ? reclaimStale.pipe(Effect.andThen(create)) : Effect.fail(error),
                ),
              ),
          ),
        );
        yield* createOrReclaim.pipe(
          Effect.retry({
            schedule: Schedule.spaced("20 millis").pipe(Schedule.upTo({ times: 99 })),
            while: () => true,
          }),
          Effect.mapError((error) => mapPlatformError("acquire lock", lockPath, error)),
        );
      }),
    (candidate) => fs.remove(candidate, { force: true, recursive: true }).pipe(Effect.ignore),
  );
  return token;
});

const withLock = <A, E, R>(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  crypto: Crypto.Crypto,
  lockPath: string,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    acquireLock(fs, path, crypto, lockPath),
    () => effect,
    (token) =>
      fs.readFileString(path.join(lockPath, "owner")).pipe(
        Effect.flatMap((text) =>
          text.startsWith(`${token}\n`)
            ? fs.remove(lockPath, { force: true, recursive: true })
            : Effect.void,
        ),
        Effect.ignore,
      ),
  );

const readOptionalText = Effect.fn("RepositoryStore.readOptionalText")(function* (
  fs: FileSystem.FileSystem,
  filePath: string,
) {
  const exists = yield* fs
    .exists(filePath)
    .pipe(Effect.mapError((error) => mapPlatformError("check", filePath, error)));
  if (!exists) return Option.none<string>();
  const text = yield* fs
    .readFileString(filePath)
    .pipe(Effect.mapError((error) => mapPlatformError("read", filePath, error)));
  return Option.some(text);
});

const sameText = (left: Option.Option<string>, right: Option.Option<string>) =>
  Option.getOrNull(left) === Option.getOrNull(right);

const readIndex = Effect.fn("RepositoryStore.readIndex")(function* (
  fs: FileSystem.FileSystem,
  indexPath: string,
) {
  const exists = yield* fs
    .exists(indexPath)
    .pipe(Effect.mapError((error) => mapPlatformError("check", indexPath, error)));
  if (!exists) return emptyIndex;
  const text = yield* fs
    .readFileString(indexPath)
    .pipe(Effect.mapError((error) => mapPlatformError("read", indexPath, error)));
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RepositoryIndexSchema))(text).pipe(
    Effect.mapError((error) => new StackError({ message: `Invalid repository index: ${error}` })),
  );
});

export class RepositoryStore extends Context.Service<
  RepositoryStore,
  {
    readonly location: RepositoryLocation;
    readonly loadGlobal: () => Effect.Effect<Option.Option<string>, StackError>;
    readonly saveGlobal: (
      text: string,
      expected: Option.Option<string>,
    ) => Effect.Effect<void, StackError>;
    readonly loadCheckout: () => Effect.Effect<Option.Option<string>, StackError>;
    readonly saveCheckout: (
      text: string,
      expected: Option.Option<string>,
    ) => Effect.Effect<void, StackError>;
    readonly savePair: (
      globalText: string,
      expectedGlobal: Option.Option<string>,
      checkoutText: string,
      expectedCheckout: Option.Option<string>,
    ) => Effect.Effect<void, StackError>;
    readonly legacyFiles: () => Effect.Effect<readonly LegacyStackFile[], StackError>;
    readonly archiveLegacy: (files: readonly LegacyStackFile[]) => Effect.Effect<void, StackError>;
  }
>()("@cvr/stacked/services/RepositoryStore") {
  static layer = Layer.effect(
    RepositoryStore,
    Effect.gen(function* () {
      const git = yield* GitService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const crypto = yield* Crypto.Crypto;
      const config = yield* stateDirectoryConfig.pipe(
        Effect.mapError(
          (error) => new StackError({ message: `Invalid state configuration: ${error}` }),
        ),
      );
      const stateDirectory = Option.getOrElse(config.explicit, () =>
        Option.getOrElse(config.xdg, () => path.join(config.home, ".local", "state")),
      );
      const stackedStateDirectory = Option.isSome(config.explicit)
        ? stateDirectory
        : path.join(stateDirectory, "stacked");
      const commonGitDirectory = yield* git.commonGitDir().pipe(
        Effect.mapError((error) => new StackError({ message: error.message })),
        Effect.flatMap((value) => canonicalPath(fs, value)),
      );
      const absoluteGitDirectory = yield* git
        .absoluteGitDir()
        .pipe(Effect.mapError((error) => new StackError({ message: error.message })));
      const repositoryRoot = yield* git.repositoryRoot().pipe(
        Effect.mapError((error) => new StackError({ message: error.message })),
        Effect.flatMap((value) => canonicalPath(fs, value)),
      );
      const remote = yield* git.remoteUrl("origin");
      const canonicalRemote = yield* Option.match(remote, {
        onNone: () => Effect.succeed(null),
        onSome: (value) => canonicalRemoteIdentity(fs, path, repositoryRoot, value),
      });
      const identity = canonicalRemote ?? `local:${commonGitDirectory}`;
      const indexPath = path.join(stackedStateDirectory, "index.json");
      const indexLock = path.join(stackedStateDirectory, "locks", "index.lock");

      const repositoryId = yield* withLock(
        fs,
        path,
        crypto,
        indexLock,
        Effect.gen(function* () {
          const index = yield* readIndex(fs, indexPath);
          const existingId =
            canonicalRemote === null
              ? index.checkouts[commonGitDirectory]
              : index.aliases[canonicalRemote];
          const id =
            existingId === undefined
              ? yield* digestIdentity(crypto, identity)
              : RepositoryId(existingId);
          const existing = index.repositories[id] ?? { aliases: [], checkouts: [] };
          const previousId = index.checkouts[commonGitDirectory];
          const previous = previousId === undefined ? undefined : index.repositories[previousId];
          const cloneRoots = sortUnique([
            ...(index.checkoutRoots?.[commonGitDirectory] ?? []),
            repositoryRoot,
          ]);
          const aliases =
            canonicalRemote === null ? existing.aliases : [...existing.aliases, canonicalRemote];
          const next: RepositoryIndex = {
            version: 1,
            aliases:
              canonicalRemote === null
                ? index.aliases
                : { ...index.aliases, [canonicalRemote]: id },
            checkouts: { ...index.checkouts, [commonGitDirectory]: id },
            checkoutRoots: {
              ...index.checkoutRoots,
              [commonGitDirectory]: cloneRoots,
            },
            repositories: {
              ...index.repositories,
              ...(previousId === undefined || previousId === id || previous === undefined
                ? {}
                : {
                    [previousId]: {
                      ...previous,
                      checkouts: previous.checkouts.filter(
                        (checkout) => !cloneRoots.includes(checkout),
                      ),
                    },
                  }),
              [id]: {
                aliases: sortUnique(aliases),
                checkouts: sortUnique([...existing.checkouts, ...cloneRoots]),
              },
            },
          };
          const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(RepositoryIndexSchema))(
            next,
          ).pipe(
            Effect.mapError(
              (error) => new StackError({ message: `Failed to encode repository index: ${error}` }),
            ),
          );
          yield* atomicWrite(fs, path, indexPath, `${encoded}\n`);
          return id;
        }),
      );

      const repositoryDirectory = path.join(stackedStateDirectory, "repositories", repositoryId);
      const stackFile = path.join(repositoryDirectory, "stacked.json");
      const repositoryLock = path.join(stackedStateDirectory, "locks", `${repositoryId}.lock`);
      const checkoutId = yield* digestIdentity(crypto, `checkout:${commonGitDirectory}`);
      const checkoutFile = path.join(
        stackedStateDirectory,
        "checkouts",
        repositoryId,
        `${checkoutId}.json`,
      );
      const legacyPaths = sortUnique([
        path.join(commonGitDirectory, "stacked.json"),
        path.join(absoluteGitDirectory, "stacked.json"),
      ]);

      return RepositoryStore.of({
        location: {
          repositoryId,
          canonicalRemote,
          stateDirectory: stackedStateDirectory,
          stackFile,
          checkoutFile,
          commonGitDirectory,
          absoluteGitDirectory,
          repositoryRoot,
        },
        loadGlobal: () => readOptionalText(fs, stackFile),
        saveGlobal: (text, expected) =>
          withLock(
            fs,
            path,
            crypto,
            repositoryLock,
            Effect.gen(function* () {
              const current = yield* readOptionalText(fs, stackFile);
              if (!sameText(current, expected)) {
                return yield* new StackError({
                  message: "Shared stack topology changed concurrently; rerun the command",
                });
              }
              yield* atomicWrite(fs, path, stackFile, text);
            }),
          ),
        loadCheckout: () => readOptionalText(fs, checkoutFile),
        saveCheckout: (text, expected) =>
          withLock(
            fs,
            path,
            crypto,
            repositoryLock,
            Effect.gen(function* () {
              const current = yield* readOptionalText(fs, checkoutFile);
              if (!sameText(current, expected)) {
                return yield* new StackError({
                  message: "Checkout synchronization state changed concurrently; rerun the command",
                });
              }
              yield* atomicWrite(fs, path, checkoutFile, text);
            }),
          ),
        savePair: (globalText, expectedGlobal, checkoutText, expectedCheckout) =>
          withLock(
            fs,
            path,
            crypto,
            repositoryLock,
            Effect.gen(function* () {
              const currentGlobal = yield* readOptionalText(fs, stackFile);
              const currentCheckout = yield* readOptionalText(fs, checkoutFile);
              if (!sameText(currentGlobal, expectedGlobal)) {
                return yield* new StackError({
                  message: "Shared stack topology changed concurrently; rerun the command",
                });
              }
              if (!sameText(currentCheckout, expectedCheckout)) {
                return yield* new StackError({
                  message: "Checkout synchronization state changed concurrently; rerun the command",
                });
              }

              yield* atomicWrite(fs, path, stackFile, globalText);
              yield* atomicWrite(fs, path, checkoutFile, checkoutText).pipe(
                Effect.catchTag("StackError", (writeError) =>
                  Option.match(expectedGlobal, {
                    onNone: () =>
                      fs
                        .remove(stackFile, { force: true })
                        .pipe(
                          Effect.mapError((error) =>
                            mapPlatformError("roll back", stackFile, error),
                          ),
                        ),
                    onSome: (previous) => atomicWrite(fs, path, stackFile, previous),
                  }).pipe(
                    Effect.catchTag("StackError", (rollbackError) =>
                      Effect.fail(
                        new StackError({
                          message: `Failed to save checkout state and roll back shared topology: ${writeError.message}; ${String(rollbackError)}`,
                        }),
                      ),
                    ),
                    Effect.andThen(Effect.fail(writeError)),
                  ),
                ),
              );
            }),
          ),
        legacyFiles: () =>
          Effect.forEach(
            legacyPaths,
            (legacyPath) =>
              Effect.gen(function* () {
                const exists = yield* fs
                  .exists(legacyPath)
                  .pipe(Effect.mapError((error) => mapPlatformError("check", legacyPath, error)));
                if (!exists) return Option.none();
                const text = yield* fs
                  .readFileString(legacyPath)
                  .pipe(Effect.mapError((error) => mapPlatformError("read", legacyPath, error)));
                return Option.some({ path: legacyPath, text } satisfies LegacyStackFile);
              }),
            { concurrency: "unbounded" },
          ).pipe(Effect.map((files) => files.flatMap(Option.toArray))),
        archiveLegacy: (files) =>
          Effect.forEach(
            files,
            (file) =>
              Effect.gen(function* () {
                const suffix = yield* crypto.randomUUIDv7.pipe(
                  Effect.mapError((error) =>
                    mapPlatformError("create backup name for", file.path, error),
                  ),
                );
                yield* fs
                  .rename(file.path, `${file.path}.migrated-v2.${suffix}.backup`)
                  .pipe(Effect.mapError((error) => mapPlatformError("archive", file.path, error)));
              }),
            { discard: true },
          ),
      });
    }),
  );

  static layerTest = (options?: {
    readonly global?: string;
    readonly checkout?: string;
    readonly legacyFiles?: readonly LegacyStackFile[];
  }) =>
    Layer.effect(
      RepositoryStore,
      Effect.gen(function* () {
        const global = yield* Ref.make(Option.fromNullishOr(options?.global));
        const checkout = yield* Ref.make(Option.fromNullishOr(options?.checkout));
        const legacyFiles = yield* Ref.make<readonly LegacyStackFile[]>(options?.legacyFiles ?? []);
        return RepositoryStore.of({
          location: {
            repositoryId: RepositoryId("repo_test"),
            canonicalRemote: null,
            stateDirectory: "/test/state",
            stackFile: "/test/state/repositories/repo_test/stacked.json",
            checkoutFile: "/test/state/checkouts/repo_test/checkout_test.json",
            commonGitDirectory: "/test/repo/.git",
            absoluteGitDirectory: "/test/repo/.git",
            repositoryRoot: "/test/repo",
          },
          loadGlobal: () => Ref.get(global),
          saveGlobal: (text, expected) =>
            Effect.gen(function* () {
              const current = yield* Ref.get(global);
              if (!sameText(current, expected)) {
                return yield* new StackError({
                  message: "Shared stack topology changed concurrently; rerun the command",
                });
              }
              yield* Ref.set(global, Option.some(text));
            }),
          loadCheckout: () => Ref.get(checkout),
          saveCheckout: (text, expected) =>
            Effect.gen(function* () {
              const current = yield* Ref.get(checkout);
              if (!sameText(current, expected)) {
                return yield* new StackError({
                  message: "Checkout synchronization state changed concurrently; rerun the command",
                });
              }
              yield* Ref.set(checkout, Option.some(text));
            }),
          savePair: (globalText, expectedGlobal, checkoutText, expectedCheckout) =>
            Effect.gen(function* () {
              const currentGlobal = yield* Ref.get(global);
              const currentCheckout = yield* Ref.get(checkout);
              if (!sameText(currentGlobal, expectedGlobal)) {
                return yield* new StackError({
                  message: "Shared stack topology changed concurrently; rerun the command",
                });
              }
              if (!sameText(currentCheckout, expectedCheckout)) {
                return yield* new StackError({
                  message: "Checkout synchronization state changed concurrently; rerun the command",
                });
              }
              yield* Ref.set(global, Option.some(globalText));
              yield* Ref.set(checkout, Option.some(checkoutText));
            }),
          legacyFiles: () => Ref.get(legacyFiles),
          archiveLegacy: (files) =>
            Ref.update(legacyFiles, (current) =>
              current.filter((candidate) => !files.some((file) => file.path === candidate.path)),
            ),
        });
      }),
    );
}
