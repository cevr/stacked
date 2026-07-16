import pc from "picocolors";
import { Config, Context, Effect, Terminal } from "effect";

// ============================================================================
// TTY & Color Detection
// ============================================================================

const stderrIsTTY = process.stderr.isTTY === true;
const stdoutIsTTY = process.stdout.isTTY === true;

// Lazy color instances — deferred so --no-color flag can set env before first use
let stderrColorsCache: ReturnType<typeof pc.createColors> | null = null;
let stdoutColorsCache: ReturnType<typeof pc.createColors> | null = null;

const colorRuntimeConfig = Config.all({
  noColor: Config.string("NO_COLOR").pipe(
    Config.map(() => true),
    Config.orElse(() => Config.succeed(false)),
  ),
  forceColor: Config.string("FORCE_COLOR").pipe(
    Config.map(() => true),
    Config.orElse(() => Config.succeed(false)),
  ),
  term: Config.string("TERM").pipe(Config.withDefault("")),
});

const isColorEnabled = Effect.fn("ui.isColorEnabled")(function* (isTTY: boolean) {
  const runtime = yield* colorRuntimeConfig;
  if (runtime.noColor) return false;
  if (runtime.forceColor) return true;
  if (runtime.term === "dumb") return false;
  return isTTY;
});

const getColors = Effect.fn("ui.getColors")(function* () {
  if (stderrColorsCache !== null) return stderrColorsCache;
  const enabled = yield* isColorEnabled(stderrIsTTY).pipe(
    Effect.catchTag("ConfigError", () => Effect.succeed(false)),
  );
  stderrColorsCache = enabled ? pc : pc.createColors(false);
  return stderrColorsCache;
});

const getStdoutColors = Effect.fn("ui.getStdoutColors")(function* () {
  if (stdoutColorsCache !== null) return stdoutColorsCache;
  const enabled = yield* isColorEnabled(stdoutIsTTY).pipe(
    Effect.catchTag("ConfigError", () => Effect.succeed(false)),
  );
  stdoutColorsCache = enabled ? pc : pc.createColors(false);
  return stdoutColorsCache;
});

// ============================================================================
// Output Config (verbose/quiet, set by global flags)
// ============================================================================

export interface OutputConfig {
  readonly verbose: boolean;
  readonly quiet: boolean;
  readonly yes: boolean;
}

export const OutputConfig = Context.Reference("@cvr/stacked/OutputConfig", {
  defaultValue: (): OutputConfig => ({ verbose: false, quiet: false, yes: false }),
});

// ============================================================================
// Interactive Prompts
// ============================================================================

export const confirm = Effect.fn("ui.confirm")(function* (message: string) {
  const config = yield* OutputConfig;
  if (config.yes || process.stdin.isTTY !== true) return true;

  const terminal = yield* Terminal.Terminal;
  process.stderr.write(`${message} [y/N] `);
  const answer = yield* terminal.readLine.pipe(
    Effect.catchTag("QuitError", () => Effect.succeed("n")),
  );
  return answer.trim().toLowerCase() === "y";
});

// ============================================================================
// Styled Output (all write to stderr)
// ============================================================================

const write = (msg: string) =>
  Effect.sync(() => {
    process.stderr.write(msg + "\n");
  });

export const success = Effect.fn("ui.success")(function* (msg: string) {
  const config = yield* OutputConfig;
  if (config.quiet) return;
  const colors = yield* getColors();
  yield* write(colors.green(`✓ ${msg}`));
});

export const warn = Effect.fn("ui.warn")(function* (msg: string) {
  const config = yield* OutputConfig;
  if (config.quiet) return;
  const colors = yield* getColors();
  yield* write(colors.yellow(`⚠ ${msg}`));
});

export const info = Effect.fn("ui.info")(function* (msg: string) {
  const config = yield* OutputConfig;
  if (config.quiet) return;
  const colors = yield* getColors();
  yield* write(colors.cyan(msg));
});

export const error = Effect.fn("ui.error")(function* (msg: string) {
  const colors = yield* getColors();
  yield* write(colors.red(msg));
});

export const verbose = Effect.fn("ui.verbose")(function* (msg: string) {
  const config = yield* OutputConfig;
  if (!config.verbose) return;
  const colors = yield* getColors();
  yield* write(colors.dim(msg));
});

// ============================================================================
// Spinner
// ============================================================================

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const withSpinner = <A, E, R>(
  message: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  if (!stderrIsTTY) {
    return write(message).pipe(Effect.andThen(effect));
  }

  return Effect.gen(function* () {
    const c = yield* getColors();
    let frame = 0;
    const interval = setInterval(() => {
      const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
      process.stderr.write(`\r${c.cyan(spinner ?? "⠋")} ${message}`);
      frame++;
    }, 80);

    const cleanup = (icon: string) =>
      Effect.sync(() => {
        clearInterval(interval);
        process.stderr.write(`\r${icon} ${message}\n`);
      });

    const result = yield* effect.pipe(
      Effect.tap(() => cleanup(c.green("✓"))),
      Effect.tapError(() => cleanup(c.red("✗"))),
      Effect.onInterrupt(() => cleanup(c.yellow("⚠"))),
    );

    return result;
  });
};

// ============================================================================
// Color Helpers — stderr (for tree views, status badges, etc.)
// ============================================================================

export const dim = Effect.fn("ui.dim")(function* (s: string) {
  const colors = yield* getColors();
  return colors.dim(s);
});

export const bold = Effect.fn("ui.bold")(function* (s: string) {
  const colors = yield* getColors();
  return colors.bold(s);
});

export const green = Effect.fn("ui.green")(function* (s: string) {
  const colors = yield* getColors();
  return colors.green(s);
});

export const yellow = Effect.fn("ui.yellow")(function* (s: string) {
  const colors = yield* getColors();
  return colors.yellow(s);
});

export const cyan = Effect.fn("ui.cyan")(function* (s: string) {
  const colors = yield* getColors();
  return colors.cyan(s);
});

export const red = Effect.fn("ui.red")(function* (s: string) {
  const colors = yield* getColors();
  return colors.red(s);
});

export const magenta = Effect.fn("ui.magenta")(function* (s: string) {
  const colors = yield* getColors();
  return colors.magenta(s);
});

// ============================================================================
// Color Helpers — stdout (for Console.log output that may be piped)
// ============================================================================

export const stdout = {
  dim: Effect.fn("ui.stdout.dim")(function* (s: string) {
    const colors = yield* getStdoutColors();
    return colors.dim(s);
  }),
  bold: Effect.fn("ui.stdout.bold")(function* (s: string) {
    const colors = yield* getStdoutColors();
    return colors.bold(s);
  }),
  green: Effect.fn("ui.stdout.green")(function* (s: string) {
    const colors = yield* getStdoutColors();
    return colors.green(s);
  }),
  yellow: Effect.fn("ui.stdout.yellow")(function* (s: string) {
    const colors = yield* getStdoutColors();
    return colors.yellow(s);
  }),
  cyan: Effect.fn("ui.stdout.cyan")(function* (s: string) {
    const colors = yield* getStdoutColors();
    return colors.cyan(s);
  }),
  red: Effect.fn("ui.stdout.red")(function* (s: string) {
    const colors = yield* getStdoutColors();
    return colors.red(s);
  }),
  magenta: Effect.fn("ui.stdout.magenta")(function* (s: string) {
    const colors = yield* getStdoutColors();
    return colors.magenta(s);
  }),
};
