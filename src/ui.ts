import pc from "picocolors";
import { Effect, ServiceMap } from "effect";

// ============================================================================
// TTY & Color Detection
// ============================================================================

const stderrIsTTY = process.stderr.isTTY === true;
const stdoutIsTTY = process.stdout.isTTY === true;

// Lazy color instances — deferred so --no-color flag can set env before first use
let _stderrColors: ReturnType<typeof pc.createColors> | null = null;
let _stdoutColors: ReturnType<typeof pc.createColors> | null = null;

const isColorEnabled = (isTTY: boolean) => {
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (process.env["FORCE_COLOR"] !== undefined) return true;
  if (process.env["TERM"] === "dumb") return false;
  return isTTY;
};

const getColors = () => {
  if (_stderrColors !== null) return _stderrColors;
  _stderrColors = isColorEnabled(stderrIsTTY) ? pc : pc.createColors(false);
  return _stderrColors;
};

const getStdoutColors = () => {
  if (_stdoutColors !== null) return _stdoutColors;
  _stdoutColors = isColorEnabled(stdoutIsTTY) ? pc : pc.createColors(false);
  return _stdoutColors;
};

// ============================================================================
// Output Config (verbose/quiet, set by global flags)
// ============================================================================

export interface OutputConfig {
  readonly verbose: boolean;
  readonly quiet: boolean;
}

export const OutputConfig = ServiceMap.Reference("@cvr/stacked/OutputConfig", {
  defaultValue: (): OutputConfig => ({ verbose: false, quiet: false }),
});

// ============================================================================
// Styled Output (all write to stderr)
// ============================================================================

const write = (msg: string) =>
  Effect.sync(() => {
    process.stderr.write(msg + "\n");
  });

export const success = (msg: string) =>
  Effect.gen(function* () {
    const config = yield* OutputConfig;
    if (config.quiet) return;
    yield* write(getColors().green(`✓ ${msg}`));
  });

export const warn = (msg: string) =>
  Effect.gen(function* () {
    const config = yield* OutputConfig;
    if (config.quiet) return;
    yield* write(getColors().yellow(`⚠ ${msg}`));
  });

export const info = (msg: string) =>
  Effect.gen(function* () {
    const config = yield* OutputConfig;
    if (config.quiet) return;
    yield* write(getColors().cyan(msg));
  });

export const error = (msg: string) => write(getColors().red(msg));

export const verbose = (msg: string) =>
  Effect.gen(function* () {
    const config = yield* OutputConfig;
    if (!config.verbose) return;
    yield* write(getColors().dim(msg));
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
    const c = getColors();
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

export const dim = (s: string) => getColors().dim(s);
export const bold = (s: string) => getColors().bold(s);
export const green = (s: string) => getColors().green(s);
export const yellow = (s: string) => getColors().yellow(s);
export const cyan = (s: string) => getColors().cyan(s);
export const red = (s: string) => getColors().red(s);
export const magenta = (s: string) => getColors().magenta(s);

// ============================================================================
// Color Helpers — stdout (for Console.log output that may be piped)
// ============================================================================

export const stdout = {
  dim: (s: string) => getStdoutColors().dim(s),
  bold: (s: string) => getStdoutColors().bold(s),
  green: (s: string) => getStdoutColors().green(s),
  yellow: (s: string) => getStdoutColors().yellow(s),
  cyan: (s: string) => getStdoutColors().cyan(s),
  red: (s: string) => getStdoutColors().red(s),
  magenta: (s: string) => getStdoutColors().magenta(s),
};
