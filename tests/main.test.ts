import { describe, expect, test } from "bun:test";

describe("main global flags", () => {
  test("conflicting --verbose and --quiet exits early with code 2", () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "run", "src/main.ts", "--verbose", "--quiet", "trunk"],
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
});
