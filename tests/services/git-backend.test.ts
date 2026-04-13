import { describe, expect, test } from "bun:test";
import { DEFAULT_GIT_BACKEND, resolveGitBackend } from "../../src/services/git-backend.js";

describe("git backend resolution", () => {
  test("defaults to the git CLI backend", () => {
    expect(DEFAULT_GIT_BACKEND).toBe("cli");
    expect(resolveGitBackend(undefined)).toBe("cli");
  });

  test("keeps es-git as an explicit opt-in", () => {
    expect(resolveGitBackend("es-git")).toBe("es-git");
  });

  test("falls back to the default for unknown values", () => {
    expect(resolveGitBackend("wat")).toBe("cli");
  });
});
