/**
 * Integration tests for sync using real git repos in /tmp.
 * These exercise the actual es-git backend (treeMergeSync, rebaseOnto)
 * against real git history — no mocks.
 */
import { describe, expect } from "effect-bun-test";
import { test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRepository, type Repository } from "es-git";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const git = (cwd: string, ...args: string[]) => {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  });
  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString();
    throw new Error(`git ${args.join(" ")} failed (${proc.exitCode}): ${stderr}`);
  }
  return proc.stdout.toString().trim();
};

const writeFile = async (dir: string, name: string, content: string) => {
  await Bun.write(join(dir, name), content);
};

/** Create a local git repo with an initial commit. */
const initFixture = async (): Promise<string> => {
  const base = await mkdtemp(join(tmpdir(), "stacked-test-"));
  git(base, "init", "repo");
  const repo = join(base, "repo");

  await writeFile(repo, "README.md", "# test\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "initial");

  return repo;
};

/** List files in a commit tree. */
const filesAt = (repo: string, ref: string) =>
  git(repo, "ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean);

/** Get file content at a ref. */
const showFile = (repo: string, ref: string, path: string) => git(repo, "show", `${ref}:${path}`);

/** es-git performRebase — mirrors GitEs.ts */
const performRebase = (
  esRepo: Repository,
  branchRef: string,
  upstreamRef: string,
  ontoRef: string,
): void => {
  const refName = (name: string) => (name.startsWith("refs/") ? name : `refs/heads/${name}`);
  const resolveOid = (ref: string) => esRepo.revparseSingle(ref);

  const branch = esRepo.getAnnotatedCommitFromReference(esRepo.getReference(refName(branchRef)));
  const upstream = esRepo.getAnnotatedCommit(esRepo.getCommit(resolveOid(upstreamRef)));
  const onto = esRepo.getAnnotatedCommit(esRepo.getCommit(resolveOid(ontoRef)));
  const sig = { name: "Test", email: "test@test.com" };
  const rebase = esRepo.rebase(branch, upstream, onto);
  while (true) {
    const op = rebase.next();
    if (op === null) break;
    rebase.commit({ committer: sig });
  }
  rebase.finish(sig);
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("sync integration fixtures", () => {
  let repo: string;
  let base: string;

  beforeEach(async () => {
    repo = await initFixture();
    base = join(repo, "..");
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  // =========================================================================
  // Fixture 1: Clean rebase — parent gets new commits, child unchanged
  // =========================================================================
  test("parent with new commits, child syncs cleanly via rebase", async () => {
    // Setup: main → feat-a → feat-b
    git(repo, "checkout", "-b", "feat-a");
    await writeFile(repo, "a.txt", "feature a\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-m", "add a.txt");
    const featATipBefore = git(repo, "rev-parse", "feat-a");

    git(repo, "checkout", "-b", "feat-b");
    await writeFile(repo, "b.txt", "feature b\n");
    git(repo, "add", "b.txt");
    git(repo, "commit", "-m", "add b.txt");

    // Add a new commit to feat-a
    git(repo, "checkout", "feat-a");
    await writeFile(repo, "a2.txt", "more feature a\n");
    git(repo, "add", "a2.txt");
    git(repo, "commit", "-m", "add a2.txt");
    const featANewTip = git(repo, "rev-parse", "feat-a");

    // Rebase feat-b onto updated feat-a (using recorded fork-point)
    const esRepo = await openRepository(repo);
    performRebase(esRepo, "feat-b", featATipBefore, featANewTip);

    // Verify result
    const files = filesAt(repo, "feat-b");
    expect(files).toContain("README.md");
    expect(files).toContain("a.txt");
    expect(files).toContain("a2.txt");
    expect(files).toContain("b.txt");
    expect(files.filter((f) => f === "a.txt")).toHaveLength(1);
  });

  // =========================================================================
  // Fixture 2: Parent amended — same file, non-conflicting
  // =========================================================================
  test("parent amended with non-conflicting change syncs cleanly", async () => {
    git(repo, "checkout", "-b", "feat-a");
    await writeFile(repo, "shared.txt", "line 1\nline 2\nline 3\n");
    git(repo, "add", "shared.txt");
    git(repo, "commit", "-m", "add shared.txt");
    const featATipBefore = git(repo, "rev-parse", "feat-a");

    git(repo, "checkout", "-b", "feat-b");
    await writeFile(repo, "b-only.txt", "b stuff\n");
    git(repo, "add", "b-only.txt");
    git(repo, "commit", "-m", "add b-only.txt");

    // Amend feat-a
    git(repo, "checkout", "feat-a");
    await writeFile(repo, "shared.txt", "line 1 AMENDED\nline 2\nline 3\n");
    git(repo, "add", "shared.txt");
    git(repo, "commit", "--amend", "--no-edit");
    const featANewTip = git(repo, "rev-parse", "feat-a");

    const esRepo = await openRepository(repo);
    performRebase(esRepo, "feat-b", featATipBefore, featANewTip);

    const files = filesAt(repo, "feat-b");
    expect(files).toContain("shared.txt");
    expect(files).toContain("b-only.txt");

    // Verify the amended content propagated
    const content = showFile(repo, "feat-b", "shared.txt");
    expect(content).toContain("AMENDED");
  });

  // =========================================================================
  // Fixture 3: Conflict detection via mergeTrees preflight
  // =========================================================================
  test("mergeTrees detects conflict when both sides modify same region", async () => {
    git(repo, "checkout", "-b", "feat-a");
    await writeFile(repo, "conflict.txt", "original content\n");
    git(repo, "add", "conflict.txt");
    git(repo, "commit", "-m", "add conflict.txt");
    const featATipBefore = git(repo, "rev-parse", "feat-a");

    git(repo, "checkout", "-b", "feat-b");
    await writeFile(repo, "conflict.txt", "child modification\n");
    git(repo, "add", "conflict.txt");
    git(repo, "commit", "-m", "modify conflict.txt in child");

    // Amend feat-a with conflicting change
    git(repo, "checkout", "feat-a");
    await writeFile(repo, "conflict.txt", "parent modification\n");
    git(repo, "add", "conflict.txt");
    git(repo, "commit", "--amend", "--no-edit");
    const featANewTip = git(repo, "rev-parse", "feat-a");

    const esRepo = await openRepository(repo);
    const oldBaseTree = esRepo.getCommit(featATipBefore).tree();
    const newBaseTree = esRepo.getCommit(featANewTip).tree();
    const branchTree = esRepo.getCommit(esRepo.revparseSingle("feat-b")).tree();

    const index = esRepo.mergeTrees(oldBaseTree, newBaseTree, branchTree);
    expect(index.hasConflicts()).toBe(true);
  });

  // =========================================================================
  // Fixture 4: Parent rebased onto updated trunk
  // =========================================================================
  test("parent rebased onto trunk, child syncs with correct fork-point", async () => {
    git(repo, "checkout", "-b", "feat-a");
    await writeFile(repo, "a.txt", "feature a\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-m", "add a.txt");
    const featATipBefore = git(repo, "rev-parse", "feat-a");

    git(repo, "checkout", "-b", "feat-b");
    await writeFile(repo, "b.txt", "feature b\n");
    git(repo, "add", "b.txt");
    git(repo, "commit", "-m", "add b.txt");

    // Trunk advances
    git(repo, "checkout", "main");
    await writeFile(repo, "trunk-update.txt", "trunk work\n");
    git(repo, "add", "trunk-update.txt");
    git(repo, "commit", "-m", "trunk update");

    // Rebase feat-a onto updated trunk
    git(repo, "checkout", "feat-a");
    git(repo, "rebase", "main");
    const featANewTip = git(repo, "rev-parse", "feat-a");

    // Now sync feat-b using old fork-point
    const esRepo = await openRepository(repo);
    performRebase(esRepo, "feat-b", featATipBefore, featANewTip);

    const files = filesAt(repo, "feat-b");
    expect(files).toContain("README.md");
    expect(files).toContain("trunk-update.txt");
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
  });

  // =========================================================================
  // Fixture 5: 3-deep stack — cascading sync without duplicates
  // =========================================================================
  test("3-deep stack: amend root, cascade sync preserves all files", async () => {
    // main → feat-a → feat-b → feat-c
    git(repo, "checkout", "-b", "feat-a");
    await writeFile(repo, "a.txt", "a\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-m", "a");
    const featATipBefore = git(repo, "rev-parse", "feat-a");

    git(repo, "checkout", "-b", "feat-b");
    await writeFile(repo, "b.txt", "b\n");
    git(repo, "add", "b.txt");
    git(repo, "commit", "-m", "b");
    const featBTipBefore = git(repo, "rev-parse", "feat-b");

    git(repo, "checkout", "-b", "feat-c");
    await writeFile(repo, "c.txt", "c\n");
    git(repo, "add", "c.txt");
    git(repo, "commit", "-m", "c");

    // Amend feat-a
    git(repo, "checkout", "feat-a");
    await writeFile(repo, "a.txt", "a amended\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "--amend", "--no-edit");
    const featANewTip = git(repo, "rev-parse", "feat-a");

    const esRepo = await openRepository(repo);

    // Sync feat-b onto updated feat-a
    performRebase(esRepo, "feat-b", featATipBefore, featANewTip);
    const featBNewTip = git(repo, "rev-parse", "feat-b");

    // Verify feat-b
    const bFiles = filesAt(repo, "feat-b");
    expect(bFiles).toContain("a.txt");
    expect(bFiles).toContain("b.txt");
    expect(showFile(repo, "feat-b", "a.txt")).toBe("a amended");

    // Sync feat-c onto updated feat-b
    performRebase(esRepo, "feat-c", featBTipBefore, featBNewTip);

    // Verify feat-c has everything, no duplicates
    const cFiles = filesAt(repo, "feat-c");
    expect(cFiles).toContain("a.txt");
    expect(cFiles).toContain("b.txt");
    expect(cFiles).toContain("c.txt");
    expect(cFiles).toContain("README.md");
    expect(cFiles.filter((f) => f === "a.txt")).toHaveLength(1);
    expect(showFile(repo, "feat-c", "a.txt")).toBe("a amended");
  });
});
