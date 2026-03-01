import { Effect, Layer, Ref, Schema, ServiceMap } from "effect";
import { rename } from "node:fs/promises";
import type { GitError } from "../errors/index.js";
import { StackError } from "../errors/index.js";
import { GitService } from "./Git.js";

export const StackSchema = Schema.Struct({
  branches: Schema.Array(Schema.String),
});

export const StackFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  trunk: Schema.String,
  stacks: Schema.Record(Schema.String, StackSchema),
});

export type Stack = typeof StackSchema.Type;
export type StackFile = typeof StackFileSchema.Type;

const emptyStackFile: StackFile = { version: 1, trunk: "main", stacks: {} };

export class StackService extends ServiceMap.Service<
  StackService,
  {
    readonly load: () => Effect.Effect<StackFile, StackError>;
    readonly save: (data: StackFile) => Effect.Effect<void, StackError>;
    readonly currentStack: () => Effect.Effect<
      { name: string; stack: Stack } | null,
      StackError | GitError
    >;
    readonly addBranch: (
      stackName: string,
      branch: string,
      after?: string,
    ) => Effect.Effect<void, StackError>;
    readonly removeBranch: (stackName: string, branch: string) => Effect.Effect<void, StackError>;
    readonly createStack: (name: string, branches: string[]) => Effect.Effect<void, StackError>;
    readonly getTrunk: () => Effect.Effect<string, StackError>;
    readonly setTrunk: (name: string) => Effect.Effect<void, StackError>;
  }
>()("@cvr/stacked/services/Stack/StackService") {
  static layer: Layer.Layer<StackService, never, GitService> = Layer.effect(
    StackService,
    Effect.gen(function* () {
      const git = yield* GitService;

      const stackFilePath = Effect.fn("stackFilePath")(function* () {
        const gitDir = yield* git
          .revParse("--absolute-git-dir")
          .pipe(
            Effect.mapError(
              (e) => new StackError({ message: `Not a git repository: ${e.message}` }),
            ),
          );
        return `${gitDir}/stacked.json`;
      });

      const StackFileJson = Schema.fromJsonString(StackFileSchema);
      const decodeStackFile = Schema.decodeUnknownEffect(StackFileJson);
      const encodeStackFile = Schema.encodeEffect(StackFileJson);

      const detectTrunk = Effect.fn("StackService.detectTrunk")(function* () {
        // Check common default branch names
        for (const candidate of ["main", "master", "develop"]) {
          const exists = yield* git
            .branchExists(candidate)
            .pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));
          if (exists) return candidate;
        }
        return "main";
      });

      const load = Effect.fn("StackService.load")(function* () {
        const path = yield* stackFilePath();
        const file = Bun.file(path);
        const exists = yield* Effect.tryPromise({
          try: () => file.exists(),
          catch: () => new StackError({ message: `Failed to check if ${path} exists` }),
        });
        if (!exists) {
          const trunk = yield* detectTrunk();
          return { ...emptyStackFile, trunk } satisfies StackFile;
        }
        const text = yield* Effect.tryPromise({
          try: () => file.text(),
          catch: () => new StackError({ message: `Failed to read ${path}` }),
        });
        return yield* decodeStackFile(text).pipe(
          Effect.catchTag("SchemaError", (e) =>
            Effect.gen(function* () {
              yield* Effect.logWarning(`Corrupted stack file, resetting: ${e.message}`);
              const trunk = yield* detectTrunk();
              return { ...emptyStackFile, trunk } satisfies StackFile;
            }),
          ),
        );
      });

      const save = Effect.fn("StackService.save")(function* (data: StackFile) {
        const path = yield* stackFilePath();
        const tmpPath = `${path}.tmp`;
        const text = yield* encodeStackFile(data).pipe(
          Effect.mapError(() => new StackError({ message: `Failed to encode stack data` })),
        );
        yield* Effect.tryPromise({
          try: () => Bun.write(tmpPath, text + "\n"),
          catch: () => new StackError({ message: `Failed to write ${tmpPath}` }),
        });
        yield* Effect.tryPromise({
          try: () => rename(tmpPath, path),
          catch: () => new StackError({ message: `Failed to rename ${tmpPath} to ${path}` }),
        });
      });

      const findBranchStack = (data: StackFile, branch: string) => {
        for (const [name, stack] of Object.entries(data.stacks)) {
          if (stack.branches.includes(branch)) {
            return { name, stack };
          }
        }
        return null;
      };

      return {
        load: () => load(),
        save: (data) => save(data),

        currentStack: Effect.fn("StackService.currentStack")(function* () {
          const branch = yield* git.currentBranch();
          const data = yield* load();
          return findBranchStack(data, branch);
        }),

        addBranch: Effect.fn("StackService.addBranch")(function* (
          stackName: string,
          branch: string,
          after?: string,
        ) {
          const data = yield* load();
          const existing = findBranchStack(data, branch);
          if (existing !== null) {
            return yield* new StackError({
              message: `Branch "${branch}" is already in stack "${existing.name}"`,
            });
          }
          const stack = data.stacks[stackName];
          if (stack === undefined) {
            return yield* new StackError({ message: `Stack "${stackName}" not found` });
          }
          const branches = [...stack.branches];
          if (after !== undefined) {
            const idx = branches.indexOf(after);
            if (idx === -1) {
              return yield* new StackError({
                message: `Branch "${after}" not in stack "${stackName}"`,
              });
            }
            branches.splice(idx + 1, 0, branch);
          } else {
            branches.push(branch);
          }
          yield* save({
            ...data,
            stacks: { ...data.stacks, [stackName]: { branches } },
          });
        }),

        removeBranch: Effect.fn("StackService.removeBranch")(function* (
          stackName: string,
          branch: string,
        ) {
          const data = yield* load();
          const stack = data.stacks[stackName];
          if (stack === undefined) {
            return yield* new StackError({ message: `Stack "${stackName}" not found` });
          }
          const branches = stack.branches.filter((b) => b !== branch);
          if (branches.length === 0) {
            const { [stackName]: _, ...rest } = data.stacks;
            yield* save({ ...data, stacks: rest });
          } else {
            yield* save({
              ...data,
              stacks: { ...data.stacks, [stackName]: { branches } },
            });
          }
        }),

        createStack: Effect.fn("StackService.createStack")(function* (
          name: string,
          branches: string[],
        ) {
          const data = yield* load();
          if (data.stacks[name] !== undefined) {
            return yield* new StackError({ message: `Stack "${name}" already exists` });
          }
          yield* save({
            ...data,
            stacks: { ...data.stacks, [name]: { branches } },
          });
        }),

        getTrunk: Effect.fn("StackService.getTrunk")(function* () {
          const data = yield* load();
          return data.trunk;
        }),

        setTrunk: Effect.fn("StackService.setTrunk")(function* (name: string) {
          const data = yield* load();
          yield* save({ ...data, trunk: name });
        }),
      };
    }),
  );

  static layerTest = (data?: StackFile, options?: { currentBranch?: string }) => {
    const initial = data ?? emptyStackFile;
    return Layer.effect(
      StackService,
      Effect.gen(function* () {
        const ref = yield* Ref.make<StackFile>(initial);

        const findBranchStack = (d: StackFile, branch: string) => {
          for (const [name, stack] of Object.entries(d.stacks)) {
            if (stack.branches.includes(branch)) {
              return { name, stack };
            }
          }
          return null;
        };

        return {
          load: () => Ref.get(ref),
          save: (d) => Ref.set(ref, d),

          currentStack: Effect.fn("test.currentStack")(function* () {
            const d = yield* Ref.get(ref);
            return findBranchStack(d, options?.currentBranch ?? "test-branch");
          }),

          addBranch: Effect.fn("test.addBranch")(function* (
            stackName: string,
            branch: string,
            after?: string,
          ) {
            yield* Ref.update(ref, (d) => {
              const stack = d.stacks[stackName];
              if (stack === undefined) return d;
              const branches = [...stack.branches];
              if (after !== undefined) {
                const idx = branches.indexOf(after);
                if (idx !== -1) branches.splice(idx + 1, 0, branch);
                else branches.push(branch);
              } else {
                branches.push(branch);
              }
              return { ...d, stacks: { ...d.stacks, [stackName]: { branches } } };
            });
          }),

          removeBranch: Effect.fn("test.removeBranch")(function* (
            stackName: string,
            branch: string,
          ) {
            yield* Ref.update(ref, (d) => {
              const stack = d.stacks[stackName];
              if (stack === undefined) return d;
              const branches = stack.branches.filter((b) => b !== branch);
              if (branches.length === 0) {
                const { [stackName]: _, ...rest } = d.stacks;
                return { ...d, stacks: rest };
              }
              return { ...d, stacks: { ...d.stacks, [stackName]: { branches } } };
            });
          }),

          createStack: Effect.fn("test.createStack")(function* (name: string, branches: string[]) {
            yield* Ref.update(ref, (d) => ({
              ...d,
              stacks: { ...d.stacks, [name]: { branches } },
            }));
          }),

          getTrunk: () => Ref.get(ref).pipe(Effect.map((d) => d.trunk)),
          setTrunk: (name: string) => Ref.update(ref, (d) => ({ ...d, trunk: name })),
        };
      }),
    );
  };
}
