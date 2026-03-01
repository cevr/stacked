import { Effect, Layer, Ref, ServiceMap } from "effect";
import { GitService } from "../../src/services/Git.js";
import { StackService } from "../../src/services/Stack.js";
import type { StackFile } from "../../src/services/Stack.js";
import { GitHubService } from "../../src/services/GitHub.js";

// ============================================================================
// Call Recording
// ============================================================================

export interface ServiceCall {
  service: string;
  method: string;
  args?: unknown;
  result?: unknown;
}

export class CallRecorder extends ServiceMap.Service<
  CallRecorder,
  {
    readonly record: (call: ServiceCall) => Effect.Effect<void>;
    readonly calls: Effect.Effect<ReadonlyArray<ServiceCall>>;
    readonly clear: Effect.Effect<void>;
  }
>()("@cvr/stacked/tests/helpers/test-cli/CallRecorder") {
  static layer = Layer.effect(
    CallRecorder,
    Effect.gen(function* () {
      const ref = yield* Ref.make<ServiceCall[]>([]);
      return {
        record: (call) => Ref.update(ref, (calls) => [...calls, call]),
        calls: Ref.get(ref),
        clear: Ref.set(ref, []),
      };
    }),
  );
}

// ============================================================================
// Mock Services
// ============================================================================

export interface MockGitOptions {
  currentBranch?: string;
  isClean?: boolean;
  branches?: Record<string, boolean>;
  allBranches?: string[];
  isAncestor?: (ancestor: string, descendant: string) => boolean;
}

export const createMockGitService = (options: MockGitOptions = {}) =>
  Layer.effect(
    GitService,
    Effect.gen(function* () {
      const recorder = yield* CallRecorder;

      return {
        currentBranch: () =>
          recorder
            .record({ service: "Git", method: "currentBranch" })
            .pipe(Effect.as(options.currentBranch ?? "main")),
        listBranches: () =>
          recorder
            .record({ service: "Git", method: "listBranches" })
            .pipe(Effect.as(options.allBranches ?? [])),
        branchExists: (name: string) =>
          recorder
            .record({ service: "Git", method: "branchExists", args: { name } })
            .pipe(Effect.as(options.branches?.[name] ?? false)),
        createBranch: (name: string, from?: string) =>
          recorder.record({ service: "Git", method: "createBranch", args: { name, from } }),
        deleteBranch: (name: string, force?: boolean) =>
          recorder.record({ service: "Git", method: "deleteBranch", args: { name, force } }),
        checkout: (name: string) =>
          recorder.record({ service: "Git", method: "checkout", args: { name } }),
        rebase: (onto: string) =>
          recorder.record({ service: "Git", method: "rebase", args: { onto } }),
        push: (branch: string, opts?: { force?: boolean }) =>
          recorder.record({ service: "Git", method: "push", args: { branch, ...opts } }),
        log: (_branch: string, _opts?: { limit?: number; oneline?: boolean }) =>
          Effect.succeed("abc123 some commit"),
        mergeBase: (_a: string, _b: string) => Effect.succeed("abc123"),
        isClean: () => Effect.succeed(options.isClean ?? true),
        revParse: (ref: string) =>
          recorder
            .record({ service: "Git", method: "revParse", args: { ref } })
            .pipe(Effect.as(".git")),
        diff: () => Effect.succeed(""),
        isAncestor: (ancestor: string, descendant: string) =>
          Effect.succeed(options.isAncestor?.(ancestor, descendant) ?? true),
        remote: () => Effect.succeed("origin"),
        fetch: () => recorder.record({ service: "Git", method: "fetch" }),
        deleteRemoteBranch: (branch: string) =>
          recorder.record({ service: "Git", method: "deleteRemoteBranch", args: { branch } }),
      };
    }),
  );

export const createMockStackService = (initial?: StackFile) => StackService.layerTest(initial);

export const createMockGitHubService = (
  overrides: Partial<ServiceMap.Service.Shape<typeof GitHubService>> = {},
) =>
  Layer.effect(
    GitHubService,
    Effect.gen(function* () {
      const recorder = yield* CallRecorder;

      return {
        createPR: (opts: {
          head: string;
          base: string;
          title: string;
          body?: string;
          draft?: boolean;
        }) =>
          recorder
            .record({ service: "GitHub", method: "createPR", args: opts })
            .pipe(Effect.as({ url: `https://github.com/test/repo/pull/1`, number: 1 })),
        updatePR: (opts: { branch: string; base?: string; title?: string; body?: string }) =>
          recorder.record({ service: "GitHub", method: "updatePR", args: opts }),
        getPR: (branch: string) =>
          recorder
            .record({ service: "GitHub", method: "getPR", args: { branch } })
            .pipe(Effect.as(null)),
        isGhInstalled: () => Effect.succeed(true),
        ...overrides,
      };
    }),
  );

// ============================================================================
// Test Layer Factory
// ============================================================================

export interface TestOptions {
  git?: MockGitOptions;
  stack?: StackFile;
  github?: Partial<ServiceMap.Service.Shape<typeof GitHubService>>;
}

export const createTestLayer = (options: TestOptions = {}) => {
  const recorderLayer = CallRecorder.layer;

  const gitLayer = createMockGitService(options.git).pipe(Layer.provide(recorderLayer));

  const stackLayer = createMockStackService(options.stack);

  const ghLayer = createMockGitHubService(options.github).pipe(Layer.provide(recorderLayer));

  return Layer.mergeAll(recorderLayer, gitLayer, stackLayer, ghLayer);
};

// ============================================================================
// Assertion Helpers
// ============================================================================

export const expectCall = (
  calls: ReadonlyArray<ServiceCall>,
  service: string,
  method: string,
  matchArgs?: Record<string, unknown>,
): ServiceCall => {
  const found = calls.find((c) => {
    if (c.service !== service || c.method !== method) return false;
    if (matchArgs === undefined) return true;
    const args = c.args as Record<string, unknown> | undefined;
    if (args === undefined) return false;
    return Object.entries(matchArgs).every(([k, v]) => args[k] === v);
  });

  if (found === undefined) {
    const argsStr =
      matchArgs !== undefined ? ` with args matching ${JSON.stringify(matchArgs)}` : "";
    throw new Error(
      `Expected call to ${service}.${method}${argsStr} but not found.\nCalls: ${JSON.stringify(calls, null, 2)}`,
    );
  }
  return found;
};

export const expectNoCall = (
  calls: ReadonlyArray<ServiceCall>,
  service: string,
  method: string,
): void => {
  const found = calls.find((c) => c.service === service && c.method === method);
  if (found !== undefined) {
    throw new Error(`Expected no call to ${service}.${method} but found: ${JSON.stringify(found)}`);
  }
};
