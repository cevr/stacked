import { existsSync } from "node:fs";
import { Effect, Layer, Option } from "effect";
import { openRepository, type Repository, type SignaturePayload } from "es-git";
import { GitError } from "../errors/index.js";
import { GitService } from "./Git.js";

const makeGitError = (command: string, error: unknown) =>
  new GitError({
    message: error instanceof Error ? error.message : String(error),
    command,
  });

const resolveSignature = (repo: Repository): SignaturePayload => {
  const config = repo.config();
  const name =
    process.env["GIT_COMMITTER_NAME"] ??
    process.env["GIT_AUTHOR_NAME"] ??
    config.findString("user.name");
  const email =
    process.env["GIT_COMMITTER_EMAIL"] ??
    process.env["GIT_AUTHOR_EMAIL"] ??
    config.findString("user.email");

  if (name === null || name === undefined || email === null || email === undefined) {
    throw makeGitError("es-git.signature", "Missing git user.name or user.email");
  }

  return { name, email };
};

const refName = (name: string) => (name.startsWith("refs/") ? name : `refs/heads/${name}`);

const resolveOid = (repo: Repository, ref: string): string => {
  if (ref === "--absolute-git-dir" || ref === "--git-dir") {
    return repo.path();
  }

  return repo.revparseSingle(ref);
};

const performRebase = (
  repo: Repository,
  branchRef: string,
  upstreamRef: string,
  ontoRef: string,
): void => {
  const branch = repo.getAnnotatedCommitFromReference(repo.getReference(branchRef));
  const upstream = repo.getAnnotatedCommit(repo.getCommit(resolveOid(repo, upstreamRef)));
  const onto = repo.getAnnotatedCommit(repo.getCommit(resolveOid(repo, ontoRef)));
  const signature = resolveSignature(repo);
  const rebase = repo.rebase(branch, upstream, onto);
  while (true) {
    const operation = rebase.next();
    if (operation === null) break;
    rebase.commit({ committer: signature });
  }

  rebase.finish(signature);
};

export const GitEsLayer = Layer.effect(
  GitService,
  Effect.gen(function* () {
    const cwd = process.cwd();
    const repo = yield* Effect.tryPromise({
      try: () => openRepository(cwd),
      catch: (error) => makeGitError(`es-git.openRepository ${cwd}`, error),
    });

    return {
      currentBranch: () =>
        Effect.try({
          try: () => {
            const branch = repo.head().shorthand();
            if (branch === "HEAD") {
              throw makeGitError(
                "es-git.currentBranch",
                "HEAD is detached — checkout a branch first",
              );
            }
            return branch;
          },
          catch: (error) => makeGitError("es-git.currentBranch", error),
        }),

      listBranches: () =>
        Effect.try({
          try: () =>
            [...repo.branches({ type: "Local" })]
              .map(({ name }) => ({
                name,
                commitTime: repo
                  .getCommit(resolveOid(repo, refName(name)))
                  .time()
                  .getTime(),
              }))
              .sort((a, b) => b.commitTime - a.commitTime)
              .map(({ name }) => name),
          catch: (error) => makeGitError("es-git.listBranches", error),
        }),

      branchExists: (name) =>
        Effect.try({
          try: () => repo.findBranch(name, "Local") !== null,
          catch: (error) => makeGitError(`es-git.branchExists ${name}`, error),
        }),

      remoteDefaultBranch: (remote = "origin") =>
        Effect.try({
          try: () => {
            const ref = repo.findReference(`refs/remotes/${remote}/HEAD`);
            if (ref === null) return Option.none();
            const target = ref.resolve().shorthand();
            const prefix = `${remote}/`;
            return Option.some(target.startsWith(prefix) ? target.slice(prefix.length) : target);
          },
          catch: (error) => makeGitError(`es-git.remoteDefaultBranch ${remote}`, error),
        }).pipe(Effect.catchTag("GitError", () => Effect.succeed(Option.none()))),

      createBranch: (name, from) =>
        Effect.try({
          try: () => {
            const commit = repo.getCommit(resolveOid(repo, from ?? "HEAD"));
            repo.createBranch(name, commit);
            repo.setHead(refName(name));
            repo.checkoutHead();
          },
          catch: (error) => makeGitError(`es-git.createBranch ${name}`, error),
        }).pipe(Effect.asVoid),

      deleteBranch: (name, force) => {
        // When force is false/undefined, shell out to `git branch -d` so git
        // enforces "must be fully merged" check. es-git has no equivalent.
        if (force !== true) {
          return Effect.tryPromise({
            try: async () => {
              const proc = Bun.spawn(["git", "branch", "-d", "--", name], {
                stdout: "pipe",
                stderr: "pipe",
              });
              const exitCode = await proc.exited;
              if (exitCode !== 0) {
                const stderr = await new Response(proc.stderr).text();
                throw new Error(stderr.trim() || `git branch -d failed with exit code ${exitCode}`);
              }
            },
            catch: (error) => makeGitError(`es-git.deleteBranch ${name}`, error),
          }).pipe(Effect.asVoid);
        }
        return Effect.try({
          try: () => {
            repo.getBranch(name, "Local").delete();
          },
          catch: (error) => makeGitError(`es-git.deleteBranch ${name}`, error),
        }).pipe(Effect.asVoid);
      },

      checkout: (name) =>
        Effect.try({
          try: () => {
            repo.setHead(refName(name));
            repo.checkoutHead();
          },
          catch: (error) => makeGitError(`es-git.checkout ${name}`, error),
        }).pipe(Effect.asVoid),

      rebase: (onto) =>
        Effect.try({
          try: () => {
            const headRef = repo.head().resolve();
            const headOid = headRef.target();
            if (headOid === null) {
              throw makeGitError(`es-git.rebase ${onto}`, "HEAD has no target");
            }

            const ontoOid = resolveOid(repo, onto);
            const upstreamOid = repo.getMergeBase(headOid, ontoOid);
            performRebase(repo, headRef.name(), upstreamOid, onto);
          },
          catch: (error) => makeGitError(`es-git.rebase ${onto}`, error),
        }).pipe(Effect.asVoid),

      rebaseOnto: (branch, newBase, oldBase) =>
        Effect.try({
          try: () => {
            performRebase(repo, refName(branch), oldBase, newBase);
          },
          catch: (error) =>
            makeGitError(`es-git.rebaseOnto ${branch} ${newBase} ${oldBase}`, error),
        }).pipe(Effect.asVoid),

      rebaseAbort: () =>
        Effect.try({
          try: () => {
            repo.openRebase().abort();
          },
          catch: (error) => makeGitError("es-git.rebaseAbort", error),
        }).pipe(Effect.asVoid),

      push: (branch, options) => {
        // es-git's protocol has no --force-with-lease equivalent; shell out to git CLI
        if (options?.force === true) {
          return Effect.tryPromise({
            try: async () => {
              const proc = Bun.spawn(
                ["git", "push", "--force-with-lease", "-u", "origin", branch],
                { stdout: "pipe", stderr: "pipe" },
              );
              const exitCode = await proc.exited;
              if (exitCode !== 0) {
                const stderr = await new Response(proc.stderr).text();
                throw new Error(stderr.trim() || `git push failed with exit code ${exitCode}`);
              }
            },
            catch: (error) => makeGitError(`es-git.push ${branch}`, error),
          }).pipe(Effect.asVoid);
        }
        return Effect.tryPromise({
          try: async () => {
            const remote = repo.getRemote("origin");
            await remote.push([`refs/heads/${branch}:refs/heads/${branch}`]);
            const localBranch = repo.findBranch(branch, "Local");
            localBranch?.setUpstream(`origin/${branch}`);
          },
          catch: (error) => makeGitError(`es-git.push ${branch}`, error),
        }).pipe(Effect.asVoid);
      },

      log: (branch, options) =>
        Effect.try({
          try: () => {
            const revwalk = repo.revwalk();
            revwalk.push(resolveOid(repo, branch));

            const lines: string[] = [];
            while (lines.length < (options?.limit ?? Number.POSITIVE_INFINITY)) {
              const oid = revwalk.next();
              if (oid === null) break;

              if (options?.oneline === true) {
                const summary = repo.getCommit(oid).summary() ?? "";
                lines.push(`${oid.slice(0, 7)} ${summary}`.trim());
              } else {
                lines.push(oid);
              }
            }

            return lines.join("\n");
          },
          catch: (error) => makeGitError(`es-git.log ${branch}`, error),
        }),

      isClean: () =>
        Effect.try({
          try: () => repo.statuses().isEmpty(),
          catch: (error) => makeGitError("es-git.isClean", error),
        }),

      revParse: (ref) =>
        Effect.try({
          try: () => resolveOid(repo, ref),
          catch: (error) => makeGitError(`es-git.revParse ${ref}`, error),
        }),

      isAncestor: (ancestor, descendant) =>
        Effect.try({
          try: () =>
            repo.getMergeBase(resolveOid(repo, ancestor), resolveOid(repo, descendant)) ===
            resolveOid(repo, ancestor),
          catch: (error) => makeGitError(`es-git.isAncestor ${ancestor} ${descendant}`, error),
        }).pipe(Effect.catchTag("GitError", () => Effect.succeed(false))),

      mergeBase: (a, b) =>
        Effect.try({
          try: () => repo.getMergeBase(resolveOid(repo, a), resolveOid(repo, b)),
          catch: (error) => makeGitError(`es-git.mergeBase ${a} ${b}`, error),
        }),

      firstParentUniqueCommits: (ref, base, options) =>
        Effect.try({
          try: () => {
            const revwalk = repo.revwalk();
            revwalk.simplifyFirstParent();
            revwalk.push(resolveOid(repo, ref));
            revwalk.hide(resolveOid(repo, base));

            const commits: string[] = [];
            const limit = options?.limit ?? Number.POSITIVE_INFINITY;
            while (commits.length < limit) {
              const oid = revwalk.next();
              if (oid === null) break;
              commits.push(oid);
            }

            return commits;
          },
          catch: (error) => makeGitError(`es-git.firstParentUniqueCommits ${ref} ${base}`, error),
        }),

      isRebaseInProgress: () =>
        Effect.try({
          try: () => {
            const state = repo.state();
            if (state === "Rebase" || state === "RebaseInteractive" || state === "RebaseMerge") {
              return true;
            }

            const gitDir = repo.path();
            return existsSync(`${gitDir}/rebase-merge`) || existsSync(`${gitDir}/rebase-apply`);
          },
          catch: (error) => makeGitError("es-git.isRebaseInProgress", error),
        }).pipe(Effect.catchTag("GitError", () => Effect.succeed(false))),

      commitAmend: (options) => {
        // --edit requires an interactive editor; shell out to git CLI
        if (options?.edit === true) {
          return Effect.tryPromise({
            try: async () => {
              const proc = Bun.spawn(["git", "commit", "--amend"], {
                stdin: "inherit",
                stdout: "inherit",
                stderr: "inherit",
              });
              const exitCode = await proc.exited;
              if (exitCode !== 0) {
                throw new Error(`git commit --amend failed with exit code ${exitCode}`);
              }
            },
            catch: (error) => makeGitError("es-git.commitAmend", error),
          }).pipe(Effect.asVoid);
        }
        return Effect.try({
          try: () => {
            const headOid = repo.head().target();
            if (headOid === null) {
              throw makeGitError("es-git.commitAmend", "HEAD has no target");
            }
            repo.getCommit(headOid).amend({
              updateRef: "HEAD",
              committer: resolveSignature(repo),
            });
          },
          catch: (error) => makeGitError("es-git.commitAmend", error),
        }).pipe(Effect.asVoid);
      },

      fetch: (remote = "origin") =>
        Effect.tryPromise({
          try: async () => {
            await repo.getRemote(remote).fetch([]);
          },
          catch: (error) => makeGitError(`es-git.fetch ${remote}`, error),
        }).pipe(Effect.asVoid),

      deleteRemoteBranch: (branch) =>
        Effect.tryPromise({
          try: async () => {
            await repo.getRemote("origin").push([`:refs/heads/${branch}`]);
          },
          catch: (error) => makeGitError(`es-git.deleteRemoteBranch ${branch}`, error),
        }).pipe(Effect.asVoid),

      treeMergeSync: ({ branch, branchHead, oldBase, newBase, message }) =>
        Effect.try({
          try: () => {
            const oldBaseOid = resolveOid(repo, oldBase);
            const newBaseOid = resolveOid(repo, newBase);
            const branchHeadOid = resolveOid(repo, branchHead);

            const oldBaseTree = repo.getCommit(oldBaseOid).tree();
            const newBaseTree = repo.getCommit(newBaseOid).tree();
            const branchTree = repo.getCommit(branchHeadOid).tree();

            const index = repo.mergeTrees(oldBaseTree, newBaseTree, branchTree);

            if (index.hasConflicts()) {
              return { action: "conflict" as const };
            }

            const treeOid = index.writeTree();

            // If the tree is unchanged, no commit needed
            if (treeOid === repo.getCommit(branchHeadOid).treeId()) {
              return { action: "up-to-date" as const };
            }

            const tree = repo.getTree(treeOid);
            const signature = resolveSignature(repo);

            repo.commit(tree, message, {
              updateRef: refName(branch),
              parents: [branchHeadOid, newBaseOid],
              author: signature,
              committer: signature,
            });

            // Update working tree to match the new commit
            repo.checkoutHead();

            return { action: "merged" as const };
          },
          catch: (error) =>
            makeGitError(`es-git.treeMergeSync ${branch} ${oldBase} ${newBase}`, error),
        }),

      supportsTreeMerge: () => true,
    };
  }),
);
