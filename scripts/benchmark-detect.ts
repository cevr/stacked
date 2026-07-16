// @effect-diagnostics effect/strictEffectProvide:off
// @effect-diagnostics effect/anyUnknownInErrorContext:off
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { BunServices } from "@effect/platform-bun";
import { GitService } from "../src/services/Git.js";

const DETECT_COMMIT_LIMIT = 2048;

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split("=");
    return [key ?? "", value ?? ""];
  }),
);

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

const runGit = async <A>(cwd: string, effect: Effect.Effect<A, unknown, GitService>) =>
  withCwd(cwd, async () =>
    Effect.runPromise(
      effect.pipe(Effect.provide(GitService.layer), Effect.provide(BunServices.layer)),
    ),
  );

const writeCommit = async (cwd: string, file: string, message: string) => {
  await Bun.write(join(cwd, file), `${message} ${Date.now()}\n`);
  await runCommand(cwd, ["git", "add", file]);
  await runCommand(cwd, ["git", "commit", "-m", message]);
};

const createFixtureRepo = async (name: string) => {
  const cwd = await mkdtemp(join(tmpdir(), `stacked-detect-${name}-`));
  await runCommand(cwd, ["git", "init", "-b", "main"]);
  await runCommand(cwd, ["git", "config", "user.name", "Stacked Bench"]);
  await runCommand(cwd, ["git", "config", "user.email", "bench@example.com"]);
  await writeCommit(cwd, "README.md", "initial");
  return cwd;
};

const createLinearFixture = async () => {
  const cwd = await createFixtureRepo("linear");
  let base = "main";
  for (let i = 1; i <= 24; i++) {
    const branch = `linear-${i}`;
    await runCommand(cwd, ["git", "checkout", "-b", branch, base]);
    await writeCommit(cwd, `${branch}.txt`, branch);
    base = branch;
  }
  await runCommand(cwd, ["git", "checkout", "main"]);
  return cwd;
};

const createWideFixture = async () => {
  const cwd = await createFixtureRepo("wide");
  await runCommand(cwd, ["git", "checkout", "-b", "root", "main"]);
  await writeCommit(cwd, "root.txt", "root");
  for (let i = 1; i <= 16; i++) {
    const branch = `child-${i}`;
    await runCommand(cwd, ["git", "checkout", "-b", branch, "root"]);
    await writeCommit(cwd, `${branch}.txt`, branch);
  }
  await runCommand(cwd, ["git", "checkout", "main"]);
  return cwd;
};

const createMixedFixture = async () => {
  const cwd = await createFixtureRepo("mixed");

  let base = "main";
  for (let i = 1; i <= 10; i++) {
    const branch = `stack-a-${i}`;
    await runCommand(cwd, ["git", "checkout", "-b", branch, base]);
    await writeCommit(cwd, `${branch}.txt`, branch);
    base = branch;
  }

  await runCommand(cwd, ["git", "checkout", "main"]);
  await writeCommit(cwd, "main-advance.txt", "main advance");

  await runCommand(cwd, ["git", "checkout", "-b", "fork-root", "main"]);
  await writeCommit(cwd, "fork-root.txt", "fork-root");
  for (let i = 1; i <= 8; i++) {
    const branch = `fork-${i}`;
    await runCommand(cwd, ["git", "checkout", "-b", branch, "fork-root"]);
    await writeCommit(cwd, `${branch}.txt`, branch);
  }

  await runCommand(cwd, ["git", "checkout", "main"]);
  for (let i = 1; i <= 12; i++) {
    const branch = `solo-${i}`;
    await runCommand(cwd, ["git", "checkout", "-b", branch, "main"]);
    await writeCommit(cwd, `${branch}.txt`, branch);
    await runCommand(cwd, ["git", "checkout", "main"]);
  }

  return cwd;
};

const oldDetect = Effect.gen(function* () {
  const git = yield* GitService;
  const trunk = "main";
  const candidates = (yield* git.listBranches()).filter((branch) => branch !== trunk);
  const childOf = new Map<string, string>();

  yield* Effect.forEach(
    candidates,
    (branch) =>
      Effect.gen(function* () {
        const potentialAncestors = [trunk, ...candidates.filter((other) => other !== branch)];
        const ancestryResults = yield* Effect.forEach(
          potentialAncestors,
          (other) =>
            git.isAncestor(other, branch).pipe(
              Effect.catchTag("GitError", () => Effect.succeed(false)),
              Effect.map((is) => [other, is] as const),
            ),
          { concurrency: 8 },
        );

        const ancestors = ancestryResults.filter(([_, is]) => is).map(([name]) => name);
        if (ancestors.length === 0) return;

        let closest = ancestors[0] ?? trunk;
        for (let i = 1; i < ancestors.length; i++) {
          const candidate = ancestors[i];
          if (candidate === undefined) continue;
          const candidateIsCloser = yield* git
            .isAncestor(closest, candidate)
            .pipe(Effect.catchTag("GitError", () => Effect.succeed(false)));
          if (candidateIsCloser) closest = candidate;
        }

        childOf.set(branch, closest);
      }),
    { concurrency: 8 },
  );

  return childOf.size;
});

const newDetect = Effect.gen(function* () {
  const git = yield* GitService;
  const trunk = "main";
  const candidates = (yield* git.listBranches()).filter((branch) => branch !== trunk);

  const tipResults = yield* Effect.forEach(
    candidates,
    (branch) =>
      git.revParse(branch).pipe(
        Effect.map((oid) => [branch, oid] as const),
        Effect.catchTag("GitError", () => Effect.succeed(null)),
      ),
    { concurrency: 8 },
  );

  const tipOwners = new Map<string, string[]>();
  for (const result of tipResults) {
    if (result === null) continue;
    const [branch, oid] = result;
    const owners = tipOwners.get(oid) ?? [];
    owners.push(branch);
    tipOwners.set(oid, owners);
  }

  const childOf = new Map<string, string>();
  yield* Effect.forEach(
    candidates,
    (branch) =>
      Effect.gen(function* () {
        const commits = yield* git
          .firstParentUniqueCommits(branch, trunk, { limit: DETECT_COMMIT_LIMIT })
          .pipe(Effect.catchTag("GitError", () => Effect.succeed([])));

        if (commits.length === 0) return;

        let parent: string | null = null;
        let ambiguous = false;
        for (const oid of commits) {
          const owners = (tipOwners.get(oid) ?? []).filter((owner) => owner !== branch);
          if (owners.length > 1) {
            ambiguous = true;
            break;
          }
          const [owner] = owners;
          if (owner !== undefined) {
            parent = owner;
            break;
          }
        }

        if (ambiguous || (commits.length >= DETECT_COMMIT_LIMIT && parent === null)) {
          return;
        }

        childOf.set(branch, parent ?? trunk);
      }),
    { concurrency: 8 },
  );

  return childOf.size;
});

const average = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const timeEffect = async (cwd: string, effect: Effect.Effect<unknown, unknown, GitService>) => {
  const start = performance.now();
  await runGit(cwd, effect);
  return performance.now() - start;
};

const benchmarkFixture = async (cwd: string) => {
  const oldSamples: number[] = [];
  const newSamples: number[] = [];

  for (let i = 0; i < iterations; i++) {
    oldSamples.push(await timeEffect(cwd, oldDetect));
    newSamples.push(await timeEffect(cwd, newDetect));
  }

  return {
    oldMs: average(oldSamples),
    newMs: average(newSamples),
  };
};

const printRow = (fixture: string, result: { oldMs: number; newMs: number }) => {
  const faster =
    result.oldMs === result.newMs
      ? "tie"
      : result.oldMs < result.newMs
        ? `old x${(result.newMs / result.oldMs).toFixed(2)}`
        : `new x${(result.oldMs / result.newMs).toFixed(2)}`;

  console.log(
    `${fixture.padEnd(12)} ${result.oldMs.toFixed(2).padStart(9)} ${result.newMs.toFixed(2).padStart(9)} ${faster.padStart(10)}`,
  );
};

const fixtures = [
  { name: "linear", create: createLinearFixture },
  { name: "wide", create: createWideFixture },
  { name: "mixed", create: createMixedFixture },
] as const;

console.log(`Detect benchmark iterations: ${iterations}`);
console.log("fixture       old(ms)   new(ms)     faster");

const cleanup: Array<() => Promise<void>> = [];

try {
  for (const fixture of fixtures) {
    const cwd = await fixture.create();
    cleanup.push(() => rm(cwd, { recursive: true, force: true }));

    const result = await benchmarkFixture(cwd);
    printRow(fixture.name, result);
  }
} finally {
  for (const dispose of cleanup.reverse()) {
    await dispose();
  }
}
