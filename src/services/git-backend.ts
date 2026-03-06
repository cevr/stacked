import { Config } from "effect";
import { GitService } from "./Git.js";
import { GitEsLayer } from "./GitEs.js";

export type GitBackend = "cli" | "es-git";

export const DEFAULT_GIT_BACKEND: GitBackend = "cli";

export const resolveGitBackend = (value: string | undefined): GitBackend =>
  value === "es-git" ? "es-git" : "cli";

export const gitServiceLayerForBackend = (backend: GitBackend) =>
  backend === "es-git" ? GitEsLayer : GitService.layer;

export const gitBackendConfig = Config.string("STACKED_GIT_BACKEND").pipe(
  Config.withDefault(DEFAULT_GIT_BACKEND),
  Config.map((value) => resolveGitBackend(value)),
);
