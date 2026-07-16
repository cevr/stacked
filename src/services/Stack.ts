import { Context, Effect, Layer, Option, Ref, Schema } from "effect";
import { rename } from "node:fs/promises";
import type { GitError } from "../errors/index.js";
import { StackError } from "../errors/index.js";
import { GitService } from "./Git.js";

const StackV1Schema = Schema.Struct({
  branches: Schema.Array(Schema.String),
});

const StackFileV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  trunk: Schema.String,
  stacks: Schema.Record(Schema.String, StackV1Schema),
  mergedBranches: Schema.optional(Schema.Array(Schema.String)),
});

const StackRecordSchema = Schema.Struct({
  root: Schema.String,
});

const BranchRecordSchema = Schema.Struct({
  stack: Schema.String,
  parent: Schema.NullOr(Schema.String),
  syncedOnto: Schema.optional(Schema.NullOr(Schema.String)),
});

const StackFileV2Schema = Schema.Struct({
  version: Schema.Literal(2),
  trunk: Schema.String,
  stacks: Schema.Record(Schema.String, StackRecordSchema),
  branches: Schema.Record(Schema.String, BranchRecordSchema),
  mergedBranches: Schema.optional(Schema.Array(Schema.String)),
});

const StackFilePersistSchema = Schema.Struct({
  version: Schema.Literal(2),
  trunk: Schema.String,
  stacks: Schema.Record(Schema.String, StackRecordSchema),
  branches: Schema.Record(Schema.String, BranchRecordSchema),
  mergedBranches: Schema.Array(Schema.String),
});

type StackFileV1 = typeof StackFileV1Schema.Type;
type StackFileV2Input = typeof StackFileV2Schema.Type;
export type StackFile = StackFileV1 | StackFileV2Input;

export interface Stack {
  readonly root: string;
  readonly branches: readonly string[];
}

export interface LineageBranch {
  readonly name: string;
  readonly parent: string;
  readonly activeParent: string;
  readonly merged: boolean;
}

export interface StackLineage {
  readonly name: string;
  readonly trunk: string;
  readonly branches: readonly LineageBranch[];
}

interface CanonicalStackFile {
  readonly version: 2;
  readonly trunk: string;
  readonly stacks: Readonly<Record<string, { readonly root: string }>>;
  readonly branches: Readonly<
    Record<
      string,
      {
        readonly stack: string;
        readonly parent: string | null;
        readonly syncedOnto?: string | null | undefined;
      }
    >
  >;
  readonly mergedBranches: readonly string[];
}

interface StackSnapshot {
  readonly stacks: Readonly<Record<string, Stack>>;
  readonly branchToStack: ReadonlyMap<string, { readonly name: string; readonly stack: Stack }>;
}

interface SplitResult {
  readonly original: { readonly name: string; readonly branches: readonly string[] };
  readonly created: { readonly name: string; readonly branches: readonly string[] };
}

const emptyStackFile: CanonicalStackFile = {
  version: 2,
  trunk: "main",
  stacks: {},
  branches: {},
  mergedBranches: [],
};

const sortUnique = (values: readonly string[]) => [...new Set(values)].sort();

const migrateV1ToV2 = (input: StackFileV1): CanonicalStackFile => {
  const stacks: Record<string, { root: string }> = {};
  const branches: Record<string, { stack: string; parent: string | null }> = {};

  for (const [name, stack] of Object.entries(input.stacks)) {
    const [root] = stack.branches;
    if (root === undefined) continue;

    stacks[name] = { root };

    for (let i = 0; i < stack.branches.length; i++) {
      const branch = stack.branches[i];
      if (branch === undefined) continue;
      branches[branch] = {
        stack: name,
        parent: i === 0 ? null : (stack.branches[i - 1] ?? null),
      };
    }
  }

  return {
    version: 2,
    trunk: input.trunk,
    stacks,
    branches,
    mergedBranches: sortUnique(
      (input.mergedBranches ?? []).filter((branch) => branches[branch] === undefined),
    ),
  };
};

const normalizeStackFile = (input: StackFile): CanonicalStackFile => {
  const migrated = input.version === 1 ? migrateV1ToV2(input) : input;
  return {
    version: 2,
    trunk: migrated.trunk,
    stacks: migrated.stacks,
    branches: migrated.branches,
    mergedBranches: sortUnique(migrated.mergedBranches ?? []),
  };
};

const projectStacks = (data: CanonicalStackFile): Effect.Effect<StackSnapshot, StackError> =>
  Effect.gen(function* () {
    const branchesByStack = new Map<string, string[]>();

    for (const [branch, record] of Object.entries(data.branches)) {
      if (data.stacks[record.stack] === undefined) {
        return yield* new StackError({
          message: `Branch "${branch}" points at missing stack "${record.stack}". Run 'stacked doctor --fix'.`,
        });
      }
      const existing = branchesByStack.get(record.stack) ?? [];
      existing.push(branch);
      branchesByStack.set(record.stack, existing);
    }

    const stacks: Record<string, Stack> = {};
    const branchToStack = new Map<string, { name: string; stack: Stack }>();

    for (const [name, stackRecord] of Object.entries(data.stacks)) {
      const stackBranches = branchesByStack.get(name) ?? [];
      if (stackBranches.length === 0) {
        return yield* new StackError({
          message: `Stack "${name}" has no branches. Run 'stacked doctor --fix'.`,
        });
      }

      const rootRecord = data.branches[stackRecord.root];
      if (rootRecord === undefined || rootRecord.stack !== name || rootRecord.parent !== null) {
        return yield* new StackError({
          message: `Stack "${name}" has invalid root "${stackRecord.root}". Run 'stacked doctor --fix'.`,
        });
      }

      const childrenByParent = new Map<string | null, string[]>();
      for (const branch of stackBranches) {
        const record = data.branches[branch];
        if (record === undefined) continue;

        if (record.parent !== null) {
          const parent = data.branches[record.parent];
          if (parent === undefined || parent.stack !== name) {
            return yield* new StackError({
              message: `Branch "${branch}" points at invalid parent "${record.parent}". Run 'stacked doctor --fix'.`,
            });
          }
        }

        const children = childrenByParent.get(record.parent) ?? [];
        children.push(branch);
        childrenByParent.set(record.parent, children);
      }

      const rootChildren = childrenByParent.get(null) ?? [];
      if (rootChildren.length !== 1 || rootChildren[0] !== stackRecord.root) {
        return yield* new StackError({
          message: `Stack "${name}" has an invalid root chain. Run 'stacked doctor --fix'.`,
        });
      }

      const ordered: string[] = [];
      const visited = new Set<string>();
      let current: string | undefined = stackRecord.root;

      while (current !== undefined) {
        if (visited.has(current)) {
          return yield* new StackError({
            message: `Stack "${name}" contains a cycle at "${current}". Run 'stacked doctor --fix'.`,
          });
        }
        visited.add(current);
        ordered.push(current);

        const children: string[] = childrenByParent.get(current) ?? [];
        if (children.length > 1) {
          return yield* new StackError({
            message: `Stack "${name}" forks at "${current}". Run 'stacked doctor --fix'.`,
          });
        }

        current = children[0];
      }

      if (ordered.length !== stackBranches.length) {
        return yield* new StackError({
          message: `Stack "${name}" is disconnected. Run 'stacked doctor --fix'.`,
        });
      }

      const stack: Stack = { root: stackRecord.root, branches: ordered };
      stacks[name] = stack;
      for (const branch of ordered) {
        branchToStack.set(branch, { name, stack });
      }
    }

    return { stacks, branchToStack };
  });

const rewriteStackBranches = (
  data: CanonicalStackFile,
  stackName: string,
  branches: readonly string[],
): CanonicalStackFile => {
  const nextBranches: Record<
    string,
    { stack: string; parent: string | null; syncedOnto?: string | null }
  > = {
    ...data.branches,
  };

  for (const [branch, record] of Object.entries(nextBranches)) {
    if (record.stack === stackName) {
      delete nextBranches[branch];
    }
  }

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    if (branch === undefined) continue;
    const existing = data.branches[branch];
    const parent = i === 0 ? null : (branches[i - 1] ?? null);
    nextBranches[branch] = {
      stack: stackName,
      parent,
      ...(existing?.parent === parent && existing.syncedOnto != null
        ? { syncedOnto: existing.syncedOnto }
        : {}),
    };
  }

  if (branches.length === 0) {
    const { [stackName]: _, ...restStacks } = data.stacks;
    return {
      ...data,
      stacks: restStacks,
      branches: nextBranches,
    };
  }

  // branches.length > 0 guaranteed by the early return above
  const root = branches[0] as string;

  return {
    ...data,
    stacks: {
      ...data.stacks,
      [stackName]: { root },
    },
    branches: nextBranches,
  };
};

const projectLineage = (
  data: CanonicalStackFile,
  name: string,
  stack: Stack,
  includeMerged: boolean,
): StackLineage => {
  const merged = new Set(data.mergedBranches);
  const branches: LineageBranch[] = [];
  let activeParent = data.trunk;

  for (let index = 0; index < stack.branches.length; index++) {
    const branch = stack.branches[index];
    if (branch === undefined) continue;
    const isMerged = merged.has(branch);
    branches.push({
      name: branch,
      parent: index === 0 ? data.trunk : (stack.branches[index - 1] ?? data.trunk),
      activeParent,
      merged: isMerged,
    });
    if (includeMerged || !isMerged) activeParent = branch;
  }

  return { name, trunk: data.trunk, branches };
};

const renameStackRefs = (
  data: CanonicalStackFile,
  oldName: string,
  newName: string,
): CanonicalStackFile => {
  const stackRecord = data.stacks[oldName];
  if (stackRecord === undefined) return data;

  const { [oldName]: _, ...restStacks } = data.stacks;
  const branches: Record<
    string,
    { stack: string; parent: string | null; syncedOnto?: string | null }
  > = {};

  for (const [branch, record] of Object.entries(data.branches)) {
    branches[branch] = {
      ...record,
      stack: record.stack === oldName ? newName : record.stack,
    };
  }

  return {
    ...data,
    stacks: {
      ...restStacks,
      [newName]: stackRecord,
    },
    branches,
  };
};

interface StackServiceFactoryOptions {
  readonly loadData: () => Effect.Effect<CanonicalStackFile, StackError>;
  readonly saveData: (data: CanonicalStackFile) => Effect.Effect<void, StackError>;
  readonly currentBranch: () => Effect.Effect<string, StackError | GitError>;
  readonly detectTrunkCandidate: () => Effect.Effect<Option.Option<string>, never>;
}

const makeStackService = ({
  loadData,
  saveData,
  currentBranch,
  detectTrunkCandidate,
}: StackServiceFactoryOptions): Context.Service.Shape<typeof StackService> => {
  const snapshot = () => loadData().pipe(Effect.flatMap(projectStacks));

  const getLineage = Effect.fn("StackService.getLineage")(function* (
    branch: string,
    options?: {
      readonly includeMerged?: boolean;
    },
  ) {
    const data = yield* loadData();
    const state = yield* projectStacks(data);
    const resolved = state.branchToStack.get(branch);
    if (resolved === undefined) return null;
    return projectLineage(data, resolved.name, resolved.stack, options?.includeMerged ?? false);
  });

  const currentLineage = Effect.fn("StackService.currentLineage")(function* (options?: {
    readonly includeMerged?: boolean;
  }) {
    const branch = yield* currentBranch();
    return yield* getLineage(branch, options);
  });

  return {
    load: () => loadData(),
    save: (data) => saveData(normalizeStackFile(data)),

    listStacks: () =>
      snapshot().pipe(
        Effect.map((state) =>
          Object.entries(state.stacks).map(([name, stack]) => ({ name, stack })),
        ),
      ),

    getStack: (name) => snapshot().pipe(Effect.map((state) => state.stacks[name] ?? null)),

    trackedBranches: () => loadData().pipe(Effect.map((data) => Object.keys(data.branches).sort())),

    findBranchStack: (branch) =>
      snapshot().pipe(Effect.map((state) => state.branchToStack.get(branch) ?? null)),

    detectTrunkCandidate: () => detectTrunkCandidate(),

    currentStack: Effect.fn("StackService.currentStack")(function* () {
      const branch = yield* currentBranch();
      const state = yield* snapshot();
      return state.branchToStack.get(branch) ?? null;
    }),

    currentLineage,
    getLineage,

    addBranch: Effect.fn("StackService.addBranch")(function* (
      stackName: string,
      branch: string,
      after?: string,
    ) {
      const data = yield* loadData();
      const state = yield* projectStacks(data);

      if (data.branches[branch] !== undefined) {
        const existing = state.branchToStack.get(branch);
        return yield* new StackError({
          message: `Branch "${branch}" is already in stack "${existing?.name ?? data.branches[branch]?.stack ?? "unknown"}"`,
        });
      }

      const stack = state.stacks[stackName];
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

      const next = rewriteStackBranches(data, stackName, branches);
      yield* saveData({
        ...next,
        mergedBranches: next.mergedBranches.filter((name) => name !== branch),
      });
    }),

    removeBranch: Effect.fn("StackService.removeBranch")(function* (branch: string) {
      const data = yield* loadData();
      const state = yield* projectStacks(data);
      const resolved = state.branchToStack.get(branch);
      if (resolved === undefined) {
        return yield* new StackError({ message: `Branch "${branch}" not found in any stack` });
      }

      const stackName = resolved.name;
      const stack = resolved.stack;
      const remaining = stack.branches.filter((name) => name !== branch);
      const { [branch]: _, ...remainingBranches } = data.branches;

      if (remaining.length === 0) {
        const { [stackName]: __, ...restStacks } = data.stacks;
        yield* saveData({
          ...data,
          stacks: restStacks,
          branches: remainingBranches,
        });
        return;
      }

      let next: CanonicalStackFile = {
        ...data,
        branches: remainingBranches,
      };

      if (branch === stack.root && stackName === stack.root) {
        const [nextRoot] = remaining;
        if (nextRoot !== undefined) {
          next = renameStackRefs(next, stackName, nextRoot);
          yield* saveData(rewriteStackBranches(next, nextRoot, remaining));
          return;
        }
      }

      yield* saveData(rewriteStackBranches(next, stackName, remaining));
    }),

    createStack: Effect.fn("StackService.createStack")(function* (
      name: string,
      branches: string[],
    ) {
      if (branches.length === 0) {
        return yield* new StackError({
          message: `Stack "${name}" must contain at least one branch`,
        });
      }

      const duplicate = branches.find((branch, index) => branches.indexOf(branch) !== index);
      if (duplicate !== undefined) {
        return yield* new StackError({
          message: `Branch "${duplicate}" appears more than once in stack "${name}"`,
        });
      }

      const data = yield* loadData();
      if (data.stacks[name] !== undefined) {
        return yield* new StackError({ message: `Stack "${name}" already exists` });
      }

      for (const branch of branches) {
        const existing = data.branches[branch];
        if (existing !== undefined) {
          return yield* new StackError({
            message: `Branch "${branch}" is already in stack "${existing.stack}"`,
          });
        }
      }

      const next = rewriteStackBranches(
        {
          ...data,
          stacks: {
            ...data.stacks,
            [name]: { root: branches[0] ?? name },
          },
        },
        name,
        branches,
      );
      yield* saveData({
        ...next,
        mergedBranches: next.mergedBranches.filter((branch) => !branches.includes(branch)),
      });
    }),

    renameStack: Effect.fn("StackService.renameStack")(function* (
      oldName: string,
      newName: string,
    ) {
      const data = yield* loadData();
      if (data.stacks[oldName] === undefined) {
        return yield* new StackError({ message: `Stack "${oldName}" not found` });
      }
      if (data.stacks[newName] !== undefined) {
        return yield* new StackError({ message: `Stack "${newName}" already exists` });
      }
      yield* saveData(renameStackRefs(data, oldName, newName));
    }),

    splitStack: Effect.fn("StackService.splitStack")(function* (branch: string) {
      const data = yield* loadData();
      const state = yield* projectStacks(data);
      const resolved = state.branchToStack.get(branch);
      if (resolved === undefined) {
        return yield* new StackError({ message: `Branch "${branch}" not found in any stack` });
      }

      const stackName = resolved.name;
      const branches = [...resolved.stack.branches];
      const splitIndex = branches.indexOf(branch);
      if (splitIndex <= 0) {
        return yield* new StackError({
          message: `Branch "${branch}" is at the bottom of the stack — nothing to split`,
        });
      }

      if (data.stacks[branch] !== undefined) {
        return yield* new StackError({
          message: `Stack "${branch}" already exists — choose a different split point or rename it first`,
        });
      }

      const original = branches.slice(0, splitIndex);
      const created = branches.slice(splitIndex);
      let next = rewriteStackBranches(data, stackName, original);
      next = rewriteStackBranches(
        {
          ...next,
          stacks: {
            ...next.stacks,
            [branch]: { root: branch },
          },
        },
        branch,
        created,
      );
      yield* saveData(next);

      return {
        original: { name: stackName, branches: original },
        created: { name: branch, branches: created },
      } satisfies SplitResult;
    }),

    reorderBranch: Effect.fn("StackService.reorderBranch")(function* (
      branch: string,
      position: { before?: string; after?: string },
    ) {
      const data = yield* loadData();
      const state = yield* projectStacks(data);
      const resolved = state.branchToStack.get(branch);
      if (resolved === undefined) {
        return yield* new StackError({ message: `Branch "${branch}" not found in any stack` });
      }

      const stackName = resolved.name;
      const branches = [...resolved.stack.branches];
      const currentIdx = branches.indexOf(branch);
      if (currentIdx === -1) {
        return yield* new StackError({
          message: `Branch "${branch}" not found in stack "${stackName}"`,
        });
      }

      const target = position.before ?? position.after;
      if (target === undefined) {
        return yield* new StackError({
          message: "Specify --before or --after to indicate target position",
        });
      }

      const targetIdx = branches.indexOf(target);
      if (targetIdx === -1) {
        return yield* new StackError({
          message: `Branch "${target}" not found in stack "${stackName}"`,
        });
      }

      branches.splice(currentIdx, 1);
      const nextTargetIdx = branches.indexOf(target);
      branches.splice(position.before !== undefined ? nextTargetIdx : nextTargetIdx + 1, 0, branch);

      const next = rewriteStackBranches(data, stackName, branches);
      yield* saveData(next);

      return {
        name: stackName,
        stack: { root: branches[0] ?? resolved.stack.root, branches },
      };
    }),

    markMergedBranches: Effect.fn("StackService.markMergedBranches")(function* (
      branches: readonly string[],
    ) {
      if (branches.length === 0) return;
      const data = yield* loadData();
      yield* saveData({
        ...data,
        mergedBranches: sortUnique([...data.mergedBranches, ...branches]),
      });
    }),

    unmarkMergedBranches: Effect.fn("StackService.unmarkMergedBranches")(function* (
      branches: readonly string[],
    ) {
      if (branches.length === 0) return;
      const branchSet = new Set(branches);
      const data = yield* loadData();
      yield* saveData({
        ...data,
        mergedBranches: data.mergedBranches.filter((branch) => !branchSet.has(branch)),
      });
    }),

    getSyncedOnto: Effect.fn("StackService.getSyncedOnto")(function* (branch: string) {
      const data = yield* loadData();
      const record = data.branches[branch];
      if (record === undefined) return null;
      return record.syncedOnto ?? null;
    }),

    updateSyncedOnto: Effect.fn("StackService.updateSyncedOnto")(function* (
      branch: string,
      oid: string | null,
    ) {
      const data = yield* loadData();
      const record = data.branches[branch];
      if (record === undefined) {
        return yield* new StackError({
          message: `Branch "${branch}" not found in stack metadata`,
        });
      }
      yield* saveData({
        ...data,
        branches: {
          ...data.branches,
          [branch]: { ...record, syncedOnto: oid },
        },
      });
    }),

    getTrunk: Effect.fn("StackService.getTrunk")(function* () {
      const data = yield* loadData();
      return data.trunk;
    }),

    setTrunk: Effect.fn("StackService.setTrunk")(function* (name: string) {
      const data = yield* loadData();
      yield* saveData({ ...data, trunk: name });
    }),
  };
};

export class StackService extends Context.Service<
  StackService,
  {
    readonly load: () => Effect.Effect<CanonicalStackFile, StackError>;
    readonly save: (data: StackFile) => Effect.Effect<void, StackError>;
    readonly listStacks: () => Effect.Effect<
      ReadonlyArray<{ readonly name: string; readonly stack: Stack }>,
      StackError
    >;
    readonly getStack: (name: string) => Effect.Effect<Stack | null, StackError>;
    readonly trackedBranches: () => Effect.Effect<readonly string[], StackError>;
    readonly currentStack: () => Effect.Effect<
      { name: string; stack: Stack } | null,
      StackError | GitError
    >;
    readonly currentLineage: (options?: {
      readonly includeMerged?: boolean;
    }) => Effect.Effect<StackLineage | null, StackError | GitError>;
    readonly getLineage: (
      branch: string,
      options?: { readonly includeMerged?: boolean },
    ) => Effect.Effect<StackLineage | null, StackError>;
    readonly addBranch: (
      stackName: string,
      branch: string,
      after?: string,
    ) => Effect.Effect<void, StackError>;
    readonly removeBranch: (branch: string) => Effect.Effect<void, StackError>;
    readonly createStack: (name: string, branches: string[]) => Effect.Effect<void, StackError>;
    readonly renameStack: (oldName: string, newName: string) => Effect.Effect<void, StackError>;
    readonly splitStack: (branch: string) => Effect.Effect<SplitResult, StackError>;
    readonly reorderBranch: (
      branch: string,
      position: { before?: string; after?: string },
    ) => Effect.Effect<{ name: string; stack: Stack }, StackError>;
    readonly markMergedBranches: (branches: readonly string[]) => Effect.Effect<void, StackError>;
    readonly unmarkMergedBranches: (branches: readonly string[]) => Effect.Effect<void, StackError>;
    readonly findBranchStack: (
      branch: string,
    ) => Effect.Effect<{ name: string; stack: Stack } | null, StackError>;
    readonly detectTrunkCandidate: () => Effect.Effect<Option.Option<string>, never>;
    readonly getSyncedOnto: (branch: string) => Effect.Effect<string | null, StackError>;
    readonly updateSyncedOnto: (
      branch: string,
      oid: string | null,
    ) => Effect.Effect<void, StackError>;
    readonly getTrunk: () => Effect.Effect<string, StackError>;
    readonly setTrunk: (name: string) => Effect.Effect<void, StackError>;
  }
>()("@cvr/stacked/services/Stack/StackService") {
  static layer: Layer.Layer<StackService, StackError, GitService> = Layer.effect(
    StackService,
    Effect.gen(function* () {
      const git = yield* GitService;

      // Resolve git dir once at construction time, then capture in closure
      const gitDir = yield* git
        .revParse("--absolute-git-dir")
        .pipe(
          Effect.mapError((e) => new StackError({ message: `Not a git repository: ${e.message}` })),
        );
      const resolvedStackFilePath = `${gitDir}/stacked.json`;
      const stackFilePath = () => Effect.succeed(resolvedStackFilePath);

      const StackFileJson = Schema.fromJsonString(
        Schema.Union([StackFileV1Schema, StackFileV2Schema]),
      );
      const PersistStackFileJson = Schema.fromJsonString(StackFilePersistSchema);
      const decodeStackFile = Schema.decodeUnknownEffect(StackFileJson);
      const encodeStackFile = Schema.encodeEffect(PersistStackFileJson);

      const detectTrunkCandidate = Effect.fn("StackService.detectTrunkCandidate")(function* () {
        const remoteDefault = yield* git.remoteDefaultBranch("origin");
        if (Option.isSome(remoteDefault)) {
          const exists = yield* git
            .branchExists(remoteDefault.value)
            .pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));
          if (exists) return remoteDefault;
        }

        for (const candidate of ["main", "master", "develop"]) {
          const exists = yield* git
            .branchExists(candidate)
            .pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));
          if (exists) return Option.some(candidate);
        }
        return Option.none();
      });

      const detectTrunk = Effect.fn("StackService.detectTrunk")(function* () {
        const candidate = yield* detectTrunkCandidate();
        return Option.getOrElse(candidate, () => "main");
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
          Effect.map((data) => normalizeStackFile(data as StackFile)),
          Effect.catchTag("SchemaError", (e) =>
            Effect.gen(function* () {
              const backupPath = `${path}.backup`;
              yield* Effect.tryPromise({
                try: () => Bun.write(backupPath, text),
                catch: () => new StackError({ message: `Failed to write backup to ${backupPath}` }),
              });
              yield* Effect.logWarning(
                `Corrupted stack file, resetting: ${e.message}\nBackup saved to ${backupPath}`,
              );
              const trunk = yield* detectTrunk();
              return { ...emptyStackFile, trunk } satisfies StackFile;
            }),
          ),
        );
      });

      const save = Effect.fn("StackService.save")(function* (data: StackFile) {
        const path = yield* stackFilePath();
        const tmpPath = `${path}.tmp`;
        const text = yield* encodeStackFile(normalizeStackFile(data)).pipe(
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

      return makeStackService({
        loadData: () => load(),
        saveData: (data) => save(data),
        currentBranch: () => git.currentBranch(),
        detectTrunkCandidate: () => detectTrunkCandidate(),
      });
    }),
  );

  static layerTest = (
    data?: StackFile,
    options?: { currentBranch?: string; detectTrunkCandidate?: Option.Option<string> },
  ) => {
    const initial = normalizeStackFile(data ?? emptyStackFile);
    return Layer.effect(
      StackService,
      Effect.gen(function* () {
        const ref = yield* Ref.make<CanonicalStackFile>(initial);

        return makeStackService({
          loadData: () => Ref.get(ref),
          saveData: (next) => Ref.set(ref, normalizeStackFile(next)),
          currentBranch: () => Effect.succeed(options?.currentBranch ?? "test-branch"),
          detectTrunkCandidate: () =>
            Effect.succeed(
              options?.detectTrunkCandidate !== undefined
                ? options.detectTrunkCandidate
                : Option.some(initial.trunk),
            ),
        });
      }),
    );
  };
}
