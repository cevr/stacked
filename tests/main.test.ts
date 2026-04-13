import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mainPath = join(import.meta.dir, "..", "src", "main.ts");

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
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString().trim()}`);
  }
};

describe("main CLI", () => {
  test("conflicting --verbose and --quiet exits early with code 2", () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "run", mainPath, "--verbose", "--quiet", "trunk"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = new TextDecoder().decode(proc.stdout).trim();
    const stderr = new TextDecoder().decode(proc.stderr);

    expect(proc.exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--verbose and --quiet are mutually exclusive");
  });

  test("status uses the CLI git backend by default", async () => {
    const base = await mkdtemp(join(tmpdir(), "stacked-main-test-"));
    try {
      git(base, "init", "-b", "main", "repo");
      const repo = join(base, "repo");
      await Bun.write(join(repo, "README.md"), "# test\n");
      git(repo, "add", "README.md");
      git(repo, "commit", "-m", "initial");

      const env = { ...process.env };
      delete env["STACKED_GIT_BACKEND"];
      const proc = Bun.spawnSync({
        cmd: ["bun", "run", mainPath, "status", "--json"],
        cwd: repo,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });

      expect(proc.exitCode).toBe(0);
      expect(JSON.parse(proc.stdout.toString())).toMatchObject({
        branch: "main",
        clean: true,
        stack: null,
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
