// @effect-diagnostics effect/strictEffectProvide:off
// @effect-diagnostics effect/anyUnknownInErrorContext:off
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, ServiceMap } from "effect";
import { GitService } from "../src/services/Git.js";
import {
  DEFAULT_GIT_BACKEND,
  type GitBackend,
  gitServiceLayerForBackend,
} from "../src/services/git-backend.js";

type ReadOperation = {
  name: string;
  run: Effect.Effect<unknown, unknown, GitService>;
};

type MutationFixture = {
  cwd: string;
  cleanup?: () => Promise<void>;
};

type MutationOperation = {
  name: string;
  setup: (sourceRepo: string) => Promise<MutationFixture>;
  run: Effect.Effect<unknown, unknown, GitService>;
};

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split("=");
    return [key ?? "", value ?? ""];
  }),
);

const repoPath = args.get("--repo") ?? process.cwd();
const iterations = Number.parseInt(args.get("--iterations") ?? "5", 10);

const runCommand = async (cwd: string, command: string[]) => {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `${command.join(" ")} failed`);
  }

  return stdout.trim();
};

const withCwd = async <A>(cwd: string, run: () => Promise<A>) => {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await run();
  } finally {
    process.chdir(previous);
  }
};

const runWithBackend = async <A>(
  cwd: string,
  backend: GitBackend,
  effect: Effect.Effect<A, unknown, GitService>,
) =>
  withCwd(cwd, async () =>
    Effect.runPromise(effect.pipe(Effect.provide(gitServiceLayerForBackend(backend)))),
  );

const timeEffect = async <A>(
  cwd: string,
  backend: GitBackend,
  effect: Effect.Effect<A, unknown, GitService>,
) => {
  const start = performance.now();
  await runWithBackend(cwd, backend, effect);
  return performance.now() - start;
};

const createWorkClone = async (sourceRepo: string) => {
  const root = await mkdtemp(join(tmpdir(), "stacked-git-bench-"));
  const remote = join(root, "remote.git");
  const work = join(root, "work");

  await runCommand(root, ["git", "clone", "--bare", sourceRepo, remote]);
  await runCommand(root, ["git", "clone", remote, work]);
  await runCommand(work, ["git", "config", "user.name", "Stacked Bench"]);
  await runCommand(work, ["git", "config", "user.email", "bench@example.com"]);

  return {
    root,
    remote,
    work,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

const getCurrentBranch = async (cwd: string) =>
  runCommand(cwd, ["git", "rev-parse", "--abbrev-ref", "HEAD"]);

type GitApi = ServiceMap.Service.Shape<typeof GitService>;

const withGit = <A>(run: (git: GitApi) => Effect.Effect<A, unknown>) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    return yield* run(git);
  });

const readOperations: ReadOperation[] = [
  { name: "currentBranch", run: withGit((git) => git.currentBranch()) },
  { name: "listBranches", run: withGit((git) => git.listBranches()) },
  { name: "branchExists", run: withGit((git) => git.branchExists("main")) },
  { name: "remoteDefaultBranch", run: withGit((git) => git.remoteDefaultBranch("origin")) },
  { name: "isClean", run: withGit((git) => git.isClean()) },
  { name: "revParse", run: withGit((git) => git.revParse("HEAD")) },
  { name: "mergeBase", run: withGit((git) => git.mergeBase("HEAD", "HEAD~1")) },
  { name: "isAncestor", run: withGit((git) => git.isAncestor("HEAD~1", "HEAD")) },
  {
    name: "firstParentUniqueCommits",
    run: withGit((git) => git.firstParentUniqueCommits("HEAD", "HEAD~1", { limit: 20 })),
  },
  { name: "log", run: withGit((git) => git.log("HEAD", { limit: 20, oneline: true })) },
];

const mutationOperations: MutationOperation[] = [
  {
    name: "create-delete-branch",
    setup: async (sourceRepo) => {
      const fixture = await createWorkClone(sourceRepo);
      return { cwd: fixture.work, cleanup: fixture.cleanup };
    },
    run: Effect.gen(function* () {
      const git = yield* GitService;
      const base = yield* git.currentBranch();
      yield* git.createBranch("bench-temp");
      yield* git.checkout(base);
      yield* git.deleteBranch("bench-temp", true);
    }),
  },
  {
    name: "checkout-roundtrip",
    setup: async (sourceRepo) => {
      const fixture = await createWorkClone(sourceRepo);
      const base = await getCurrentBranch(fixture.work);
      await runCommand(fixture.work, ["git", "checkout", "-b", "bench-checkout"]);
      await runCommand(fixture.work, ["git", "checkout", base]);
      return { cwd: fixture.work, cleanup: fixture.cleanup };
    },
    run: Effect.gen(function* () {
      const git = yield* GitService;
      const base = yield* git.currentBranch();
      yield* git.checkout("bench-checkout");
      yield* git.checkout(base);
    }),
  },
  {
    name: "fetch-origin",
    setup: async (sourceRepo) => {
      const fixture = await createWorkClone(sourceRepo);
      const writer = join(fixture.root, "writer");
      const base = await getCurrentBranch(fixture.work);

      await runCommand(fixture.root, ["git", "clone", fixture.remote, writer]);
      await runCommand(writer, ["git", "config", "user.name", "Stacked Bench"]);
      await runCommand(writer, ["git", "config", "user.email", "bench@example.com"]);
      await runCommand(writer, ["git", "checkout", base]);
      await Bun.write(join(writer, "bench-fetch.txt"), `${Date.now()}\n`);
      await runCommand(writer, ["git", "add", "bench-fetch.txt"]);
      await runCommand(writer, ["git", "commit", "-m", "bench fetch"]);
      await runCommand(writer, ["git", "push", "origin", base]);

      return { cwd: fixture.work, cleanup: fixture.cleanup };
    },
    run: withGit((git) => git.fetch("origin")),
  },
  {
    name: "push-delete-remote-branch",
    setup: async (sourceRepo) => {
      const fixture = await createWorkClone(sourceRepo);
      await runCommand(fixture.work, ["git", "checkout", "-b", "bench-push"]);
      await Bun.write(join(fixture.work, "bench-push.txt"), `${Date.now()}\n`);
      await runCommand(fixture.work, ["git", "add", "bench-push.txt"]);
      await runCommand(fixture.work, ["git", "commit", "-m", "bench push"]);
      return { cwd: fixture.work, cleanup: fixture.cleanup };
    },
    run: Effect.gen(function* () {
      const git = yield* GitService;
      yield* git.push("bench-push", { force: true });
      yield* git.deleteRemoteBranch("bench-push");
    }),
  },
];

const average = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const benchmarkReads = async (backend: GitBackend) => {
  const results: Array<{ name: string; ms: number }> = [];

  for (const operation of readOperations) {
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      samples.push(await timeEffect(repoPath, backend, operation.run));
    }
    results.push({ name: operation.name, ms: average(samples) });
  }

  return results;
};

const benchmarkMutations = async (backend: GitBackend) => {
  const results: Array<{ name: string; ms: number }> = [];

  for (const operation of mutationOperations) {
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const fixture = await operation.setup(repoPath);
      try {
        samples.push(await timeEffect(fixture.cwd, backend, operation.run));
      } finally {
        await fixture.cleanup?.();
      }
    }
    results.push({ name: operation.name, ms: average(samples) });
  }

  return results;
};

const printTable = (
  title: string,
  cliResults: Array<{ name: string; ms: number }>,
  esGitResults: Array<{ name: string; ms: number }>,
) => {
  console.log(`\n${title}`);
  console.log("operation                  cli(ms)   es-git(ms)   faster");

  for (const cliResult of cliResults) {
    const esGitResult = esGitResults.find((entry) => entry.name === cliResult.name);
    if (esGitResult === undefined) continue;

    const faster =
      cliResult.ms === esGitResult.ms
        ? "tie"
        : cliResult.ms < esGitResult.ms
          ? `cli x${(esGitResult.ms / cliResult.ms).toFixed(2)}`
          : `es-git x${(cliResult.ms / esGitResult.ms).toFixed(2)}`;

    console.log(
      `${cliResult.name.padEnd(25)} ${cliResult.ms.toFixed(2).padStart(8)} ${esGitResult.ms.toFixed(2).padStart(12)} ${faster.padStart(10)}`,
    );
  }
};

console.log(`Benchmark repo: ${repoPath}`);
console.log(`Iterations: ${iterations}`);
console.log(`Default backend: ${DEFAULT_GIT_BACKEND}`);

const cliReads = await benchmarkReads("cli");
const esGitReads = await benchmarkReads("es-git");
printTable("Read Operations", cliReads, esGitReads);

const cliMutations = await benchmarkMutations("cli");
const esGitMutations = await benchmarkMutations("es-git");
printTable("Mutation Operations", cliMutations, esGitMutations);
