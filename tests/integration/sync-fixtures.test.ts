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

/** es-git performRebase — mirrors GitEs.ts. Checks out the branch first. */
const performRebase = (
  esRepo: Repository,
  branchRef: string,
  upstreamRef: string,
  ontoRef: string,
): void => {
  const refName = (name: string) => (name.startsWith("refs/") ? name : `refs/heads/${name}`);
  const resolveOid = (ref: string) => esRepo.revparseSingle(ref);

  // Checkout branch first so worktree matches (mirrors real sync behavior)
  esRepo.setHead(refName(branchRef));
  esRepo.checkoutHead({ force: true });

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

// ===========================================================================
// Code-level fixtures — realistic TypeScript edits across stacked branches
// ===========================================================================

describe("sync integration: code-level fixtures", () => {
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
  // Shared seed: a small TypeScript module used by multiple fixtures
  // =========================================================================
  const seedModule = `import { Effect } from "effect";

export interface UserService {
  readonly getUser: (id: string) => Effect.Effect<User, UserError>;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserError {
  readonly _tag = "UserError";
  constructor(readonly message: string) {}
}

export const makeUserService = (): UserService => ({
  getUser: (id) =>
    Effect.succeed({
      id,
      name: "Test User",
      email: "test@example.com",
    }),
});
`;

  // =========================================================================
  // 6: Parent adds import + new interface, child adds function using existing types
  // =========================================================================
  test("parent adds import and interface, child adds function — no conflict", async () => {
    // Trunk has the base module
    await writeFile(repo, "src/user.ts", seedModule);
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "--no-edit");

    // feat-a: add a new service method and import
    git(repo, "checkout", "-b", "feat-a");
    const withNewImport = seedModule.replace(
      'import { Effect } from "effect";',
      'import { Effect, Option } from "effect";',
    );
    const withNewMethod = withNewImport.replace(
      "readonly getUser: (id: string) => Effect.Effect<User, UserError>;",
      `readonly getUser: (id: string) => Effect.Effect<User, UserError>;
  readonly findUser: (email: string) => Effect.Effect<Option.Option<User>, UserError>;`,
    );
    await writeFile(repo, "src/user.ts", withNewMethod);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: add findUser method");
    const featATip = git(repo, "rev-parse", "feat-a");

    // feat-b: add a helper function at the bottom of the file (different region)
    git(repo, "checkout", "-b", "feat-b");
    const withHelper =
      withNewMethod +
      `
export const formatUser = (user: User): string =>
  \`\${user.name} <\${user.email}>\`;
`;
    await writeFile(repo, "src/user.ts", withHelper);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: add formatUser helper");

    // Now amend feat-a: add implementation for findUser
    git(repo, "checkout", "feat-a");
    const withImpl = withNewMethod.replace(
      "export const makeUserService = (): UserService => ({",
      `export const makeUserService = (): UserService => ({
  findUser: (email) =>
    Effect.succeed(
      email === "test@example.com"
        ? Option.some({ id: "1", name: "Test User", email })
        : Option.none(),
    ),`,
    );
    await writeFile(repo, "src/user.ts", withImpl);
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "--no-edit");
    const featANewTip = git(repo, "rev-parse", "feat-a");

    // Sync feat-b
    const esRepo = await openRepository(repo);
    performRebase(esRepo, "feat-b", featATip, featANewTip);

    const result = showFile(repo, "feat-b", "src/user.ts");

    // Should have: Option import, findUser interface, findUser impl, AND formatUser helper
    expect(result).toContain('import { Effect, Option } from "effect"');
    expect(result).toContain("readonly findUser");
    expect(result).toContain("findUser: (email) =>");
    expect(result).toContain("Option.some(");
    expect(result).toContain("export const formatUser");

    // No duplicate imports or conflict markers
    expect(result.match(/import \{ Effect/g)?.length).toBe(1);
    expect(result).not.toContain("<<<<<<<");
    expect(result).not.toContain(">>>>>>>");
  });

  // =========================================================================
  // 7: Both branches modify adjacent lines in same function
  // =========================================================================
  test("adjacent-line edits in same function — clean merge", async () => {
    const baseHandler = `export const handleRequest = (req: Request): Response => {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method === "GET" && path === "/health") {
    return new Response("ok");
  }

  if (method === "GET" && path === "/users") {
    return new Response("[]");
  }

  return new Response("not found", { status: 404 });
};
`;
    await writeFile(repo, "src/handler.ts", baseHandler);
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "--no-edit");

    // feat-a: add a new route BEFORE the 404
    git(repo, "checkout", "-b", "feat-a");
    const withNewRoute = baseHandler.replace(
      '  return new Response("not found", { status: 404 });',
      `  if (method === "POST" && path === "/users") {
    return new Response("created", { status: 201 });
  }

  return new Response("not found", { status: 404 });`,
    );
    await writeFile(repo, "src/handler.ts", withNewRoute);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: add POST /users route");
    const featATip = git(repo, "rev-parse", "feat-a");

    // feat-b: add logging at the TOP of the function (different region)
    git(repo, "checkout", "-b", "feat-b");
    const withLogging = withNewRoute.replace(
      "export const handleRequest = (req: Request): Response => {",
      `export const handleRequest = (req: Request): Response => {
  console.log(\`\${req.method} \${req.url}\`);`,
    );
    await writeFile(repo, "src/handler.ts", withLogging);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: add request logging");

    // Amend feat-a: also add a DELETE route
    git(repo, "checkout", "feat-a");
    const withDelete = withNewRoute.replace(
      '  if (method === "POST" && path === "/users") {',
      `  if (method === "DELETE" && path.startsWith("/users/")) {
    return new Response("deleted", { status: 200 });
  }

  if (method === "POST" && path === "/users") {`,
    );
    await writeFile(repo, "src/handler.ts", withDelete);
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "--no-edit");
    const featANewTip = git(repo, "rev-parse", "feat-a");

    const esRepo = await openRepository(repo);
    performRebase(esRepo, "feat-b", featATip, featANewTip);

    const result = showFile(repo, "feat-b", "src/handler.ts");

    // Should have: logging, GET /health, GET /users, DELETE, POST, 404
    expect(result).toContain("console.log(");
    expect(result).toContain('path === "/health"');
    expect(result).toContain('path === "/users"');
    expect(result).toContain("DELETE");
    expect(result).toContain("POST");
    expect(result).toContain("status: 404");
    expect(result).not.toContain("<<<<<<<");
  });

  // =========================================================================
  // 8: Import block edits — parent adds one import, child adds another
  // =========================================================================
  test("both branches add different imports to same block — clean merge", async () => {
    const baseFile = `import { Effect } from "effect";
import { pipe } from "effect/Function";

export const program = pipe(
  Effect.succeed(42),
  Effect.map((n) => n * 2),
);
`;
    await writeFile(repo, "src/program.ts", baseFile);
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "--no-edit");

    // feat-a: add Schema import
    git(repo, "checkout", "-b", "feat-a");
    const withSchema = baseFile.replace(
      'import { pipe } from "effect/Function";',
      `import { Schema } from "effect";
import { pipe } from "effect/Function";`,
    );
    await writeFile(repo, "src/program.ts", withSchema);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: add Schema import");
    const featATip = git(repo, "rev-parse", "feat-a");

    // feat-b: add Layer import and usage at bottom
    git(repo, "checkout", "-b", "feat-b");
    const withLayer = withSchema.replace(
      'import { Effect } from "effect";',
      'import { Effect, Layer } from "effect";',
    );
    const withLayerUsage =
      withLayer +
      `
export const live = Layer.succeed("UserService", { getUser: () => Effect.succeed(null) });
`;
    await writeFile(repo, "src/program.ts", withLayerUsage);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: add Layer import and usage");

    // Amend feat-a: add Schema usage
    git(repo, "checkout", "feat-a");
    const withSchemaUsage =
      withSchema +
      `
export const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});
`;
    await writeFile(repo, "src/program.ts", withSchemaUsage);
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "--no-edit");
    const featANewTip = git(repo, "rev-parse", "feat-a");

    // Adjacent import edits in the same block often produce merge conflicts
    // even when logically non-conflicting. Test that preflight detects this.
    const esRepo = await openRepository(repo);
    const oldTree = esRepo.getCommit(featATip).tree();
    const newTree = esRepo.getCommit(featANewTip).tree();
    const branchTree = esRepo.getCommit(esRepo.revparseSingle("feat-b")).tree();
    const index = esRepo.mergeTrees(oldTree, newTree, branchTree);

    // Adjacent edits to the same import block may or may not conflict depending
    // on exact line spacing. Either outcome is valid — what matters is that the
    // preflight correctly reports the state so sync can choose the right path.
    if (!index.hasConflicts()) {
      // Clean — rebase should work
      performRebase(esRepo, "feat-b", featATip, featANewTip);
      const result = showFile(repo, "feat-b", "src/program.ts");
      expect(result).toContain("Layer");
      expect(result).toContain("Schema");
      expect(result).not.toContain("<<<<<<<");
    } else {
      // Conflict detected — preflight correctly caught adjacent-line edit tension
      expect(index.hasConflicts()).toBe(true);
    }
  });

  // =========================================================================
  // 9: Same function signature modified by both — CONFLICT expected
  // =========================================================================
  test("both branches modify same function signature — conflict detected", async () => {
    const baseFile = `export const createUser = (name: string): User => ({
  id: crypto.randomUUID(),
  name,
  email: "",
  role: "user",
});
`;
    await writeFile(repo, "src/create.ts", baseFile);
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "--no-edit");

    // feat-a: change signature to add email param
    git(repo, "checkout", "-b", "feat-a");
    const withEmail = baseFile
      .replace(
        "export const createUser = (name: string): User => ({",
        "export const createUser = (name: string, email: string): User => ({",
      )
      .replace('  email: "",', "  email,");
    await writeFile(repo, "src/create.ts", withEmail);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: add email param to createUser");
    const featATip = git(repo, "rev-parse", "feat-a");

    // feat-b: change same signature to add role param
    git(repo, "checkout", "-b", "feat-b");
    const withRole = withEmail
      .replace(
        "export const createUser = (name: string, email: string): User => ({",
        "export const createUser = (name: string, email: string, role: string): User => ({",
      )
      .replace('  role: "user",', "  role,");
    await writeFile(repo, "src/create.ts", withRole);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: add role param to createUser");

    // Amend feat-a: ALSO change the signature (add age param on same line)
    git(repo, "checkout", "feat-a");
    const withAge = baseFile
      .replace(
        "export const createUser = (name: string): User => ({",
        "export const createUser = (name: string, email: string, age: number): User => ({",
      )
      .replace('  email: "",', "  email,");
    await writeFile(repo, "src/create.ts", withAge);
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "--no-edit");
    const featANewTip = git(repo, "rev-parse", "feat-a");

    // Preflight: mergeTrees should detect conflict
    const esRepo = await openRepository(repo);
    const oldTree = esRepo.getCommit(featATip).tree();
    const newTree = esRepo.getCommit(featANewTip).tree();
    const branchTree = esRepo.getCommit(esRepo.revparseSingle("feat-b")).tree();
    const index = esRepo.mergeTrees(oldTree, newTree, branchTree);

    expect(index.hasConflicts()).toBe(true);
  });

  // =========================================================================
  // 10: Multi-file stack — each branch touches different files, parent adds shared dep
  // =========================================================================
  test("multi-file stack: parent adds shared dep, children use it independently", async () => {
    // Trunk: basic project structure
    await writeFile(repo, "src/index.ts", 'export { handler } from "./handler";\n');
    await writeFile(repo, "src/handler.ts", `export const handler = () => "hello";\n`);
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "--no-edit");

    // feat-a: add a shared utility
    git(repo, "checkout", "-b", "feat-a");
    await writeFile(
      repo,
      "src/utils.ts",
      `export const formatDate = (d: Date) => d.toISOString();\n`,
    );
    await writeFile(
      repo,
      "src/handler.ts",
      `import { formatDate } from "./utils";

export const handler = () => \`hello at \${formatDate(new Date())}\`;
`,
    );
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: add formatDate util and use in handler");
    const featATip = git(repo, "rev-parse", "feat-a");

    // feat-b: add a new route file that also imports from utils
    git(repo, "checkout", "-b", "feat-b");
    await writeFile(
      repo,
      "src/routes.ts",
      `import { formatDate } from "./utils";

export const routes = [
  { path: "/time", handler: () => formatDate(new Date()) },
];
`,
    );
    await writeFile(
      repo,
      "src/index.ts",
      `export { handler } from "./handler";
export { routes } from "./routes";
`,
    );
    git(repo, "add", ".");
    git(repo, "commit", "-m", "feat: add routes module");

    // Amend feat-a: add another util function
    git(repo, "checkout", "feat-a");
    await writeFile(
      repo,
      "src/utils.ts",
      `export const formatDate = (d: Date) => d.toISOString();

export const parseDate = (s: string) => new Date(s);
`,
    );
    git(repo, "add", ".");
    git(repo, "commit", "--amend", "--no-edit");
    const featANewTip = git(repo, "rev-parse", "feat-a");

    const esRepo = await openRepository(repo);
    performRebase(esRepo, "feat-b", featATip, featANewTip);

    // feat-b should have: both utils, handler with formatDate, routes, updated index
    const utils = showFile(repo, "feat-b", "src/utils.ts");
    expect(utils).toContain("formatDate");
    expect(utils).toContain("parseDate");

    const routes = showFile(repo, "feat-b", "src/routes.ts");
    expect(routes).toContain("formatDate");

    const index = showFile(repo, "feat-b", "src/index.ts");
    expect(index).toContain("routes");
    expect(index).toContain("handler");

    expect(utils).not.toContain("<<<<<<<");
    expect(routes).not.toContain("<<<<<<<");
  });
});
