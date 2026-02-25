---
name: stacked
description: Branch-based stacked PR CLI built with Effect v4 and Bun. Use when working on the stacked project — adding commands, modifying services, fixing bugs, writing tests, or extending the CLI. Triggers on any work in the stacked codebase.
---

# stacked

Branch-based stacked PR manager. Treats **branches** (not commits) as the unit. Manages parent-child branch relationships, automates rebasing, creates/updates GitHub PRs via `gh`.

Built with Effect v4 (`effect@4.0.0-beta.12`) + Bun. Uses `effect/unstable/cli` for command parsing, `ServiceMap.Service` for DI.

## Navigation

```
What are you working on?
├─ Adding a command           → §Commands + §Adding a Command
├─ Modifying a service        → §Services
├─ Fixing an error            → §Errors
├─ Writing tests              → §Testing
├─ Understanding data model   → §Data Model
└─ Build/run                  → §Development
```

## Project Structure

```
src/
├── main.ts                    # Entry point — wires CLI + services + BunRuntime
├── commands/
│   ├── index.ts               # Root command + subcommand wiring
│   ├── create.ts              # Create branch on top of current
│   ├── list.ts                # Show stack with current branch indicator
│   ├── checkout.ts            # Switch to branch in stack
│   ├── top.ts / bottom.ts     # Navigate to top/bottom of stack
│   ├── trunk.ts               # Get/set trunk branch
│   ├── sync.ts                # Fetch + rebase entire stack on trunk
│   ├── restack.ts             # Rebase children after mid-stack edits
│   ├── delete.ts              # Remove branch from stack + git
│   ├── submit.ts              # Push all + create/update PRs via gh
│   ├── adopt.ts               # Insert existing branch into stack
│   └── log.ts                 # Show commits grouped by branch
├── services/
│   ├── Git.ts                 # GitService — wraps git CLI via Bun.spawn
│   ├── Stack.ts               # StackService — CRUD on .git/stacked.json
│   └── GitHub.ts              # GitHubService — wraps gh CLI
└── errors/
    └── index.ts               # GitError, StackError, GitHubError

tests/
├── helpers/test-cli.ts        # CallRecorder, mock factories, createTestLayer
├── commands/*.test.ts         # Command logic tests
└── services/*.test.ts         # Service unit tests
```

## Data Model

Stack metadata: `.git/stacked.json`

```typescript
interface StackFile {
  version: 1;
  trunk: string; // e.g. "main"
  stacks: Record<string, Stack>; // keyed by root branch name
}

interface Stack {
  branches: string[]; // ordered bottom-to-top
}
```

- `branches[0]`'s parent = trunk
- `branches[n]`'s parent = `branches[n-1]`
- Multiple independent stacks supported
- Current stack = determined by which branch you're on

## Services

| Service         | File                     | Layer deps   | What it wraps             |
| --------------- | ------------------------ | ------------ | ------------------------- |
| `GitService`    | `src/services/Git.ts`    | none         | `git` CLI via `Bun.spawn` |
| `StackService`  | `src/services/Stack.ts`  | `GitService` | `.git/stacked.json` CRUD  |
| `GitHubService` | `src/services/GitHub.ts` | none         | `gh` CLI                  |

All use `ServiceMap.Service` pattern with `static layer` (production) and `static layerTest` (tests).

### Layer wiring (`src/main.ts`)

```typescript
const ServiceLayer = StackService.layer.pipe(
  Layer.provideMerge(GitService.layer),
  Layer.provideMerge(GitHubService.layer),
);
const AppLayer = Layer.mergeAll(ServiceLayer, BunServices.layer);
BunRuntime.runMain(cli.pipe(Effect.provide(AppLayer)));
```

## Errors

All errors use `Schema.TaggedErrorClass`:

| Error         | Fields                | Source                    |
| ------------- | --------------------- | ------------------------- |
| `GitError`    | `message`, `command?` | Git operations            |
| `StackError`  | `message`             | Stack metadata operations |
| `GitHubError` | `message`, `command?` | GitHub operations         |

## Commands

Pattern: each command file exports a `Command.make()` with handler using `Command.withHandler`.

| Command           | Flags/Args                              |
| ----------------- | --------------------------------------- |
| `create <name>`   | `--from/-f` (optional base branch)      |
| `list`            | —                                       |
| `checkout <name>` | —                                       |
| `top` / `bottom`  | —                                       |
| `trunk [name]`    | optional arg: set; omit: print          |
| `sync`            | `--trunk/-t` (override trunk)           |
| `restack`         | —                                       |
| `delete <name>`   | `--force/-f`                            |
| `submit`          | `--draft/-d`, `--force/-f`, `--dry-run` |
| `adopt <branch>`  | `--after/-a` (insert position)          |
| `log`             | —                                       |

### Adding a Command

1. Create `src/commands/<name>.ts`
2. Define flags/args with suffix names to avoid shadowing (`nameArg`, `forceFlag`)
3. Export `command` using `Command.make` + `Command.withHandler`
4. Wire into `src/commands/index.ts` via `Command.withSubcommands`
5. Add tests in `tests/commands/<name>.test.ts`

```typescript
// Pattern
import { Command, Argument, Flag } from "effect/unstable/cli";

const nameArg = Argument.string("name");
const forceFlag = Flag.boolean("force").pipe(Flag.withAlias("f"), Flag.optional);

export const command = Command.make("example", { nameArg, forceFlag }).pipe(
  Command.withHandler(({ nameArg, forceFlag }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      const stacks = yield* StackService;
      // ...
    }),
  ),
);
```

## Testing

- Runner: `bun test` with `effect-bun-test`
- Pattern: `it.effect("desc", () => Effect.gen(function* () { ... }).pipe(Effect.provide(createTestLayer(...))))`

### Test helpers (`tests/helpers/test-cli.ts`)

| Export                                      | Purpose                                            |
| ------------------------------------------- | -------------------------------------------------- |
| `CallRecorder`                              | Records service method calls for assertion         |
| `createMockGitService(opts)`                | Mock GitService (currentBranch, isClean, branches) |
| `createMockStackService(data?)`             | Uses `StackService.layerTest` with Ref             |
| `createMockGitHubService()`                 | Mock GitHubService (createPR, getPR, etc.)         |
| `createTestLayer(opts)`                     | Combines all mocks + recorder                      |
| `expectCall(calls, service, method, args?)` | Assert a call was recorded                         |
| `expectNoCall(calls, service, method)`      | Assert a call was NOT recorded                     |

### Test pattern

```typescript
import { describe, it } from "effect-bun-test";
import { Effect } from "effect";
import { CallRecorder, createTestLayer, expectCall } from "../helpers/test-cli.js";

it.effect("does the thing", () =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const recorder = yield* CallRecorder;

    yield* git.checkout("feat-a");

    const calls = yield* recorder.calls;
    expectCall(calls, "Git", "checkout", { name: "feat-a" });
  }).pipe(
    Effect.provide(
      createTestLayer({
        git: { currentBranch: "feat-a" },
        stack: {
          version: 1,
          trunk: "main",
          stacks: { "feat-a": { branches: ["feat-a", "feat-b"] } },
        },
      }),
    ),
  ),
);
```

## Development

```sh
bun run dev -- --help    # run from source
bun run gate             # typecheck + lint + fmt + test + build (parallel)
bun test                 # tests only
bun run build            # compile binary to bin/stacked + symlink ~/.bun/bin/
```

## Gotchas

- v4 CLI uses `Argument.string` / `Flag.string` (not `.text`)
- v4 renames: `Effect.catch` (not `catchAll`), `Effect.catchCause` (not `catchAllCause`)
- `Command.withAlias` does not exist in v4 — no command aliases
- Suffix flag/arg variable names (`nameArg`, `forceFlag`) to avoid `no-shadow` lint errors
- `BunServices.layer` required for CLI Environment (FileSystem, Path, Terminal, ChildProcessSpawner)
- Use `Effect.fn("name")(function* () { ... })` for all effectful functions
- Test file overrides in `.oxlintrc.json` relax `no-non-null-assertion` and `no-explicit-any`
