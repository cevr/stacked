import pc from "picocolors";
import { Effect, ServiceMap } from "effect";

// ============================================================================
// TTY & Color Detection
// ============================================================================

const isTTY = process.stderr.isTTY === true;

// Lazy color instance — deferred so --no-color flag can set env before first use
let _c: ReturnType<typeof pc.createColors> | null = null;
const getColors = () => {
  if (_c !== null) return _c;
  const enabled = (() => {
    if (process.env["NO_COLOR"] !== undefined) return false;
    if (process.env["FORCE_COLOR"] !== undefined) return true;
    if (process.env["TERM"] === "dumb") return false;
    return isTTY;
  })();
  _c = enabled ? pc : pc.createColors(false);
  return _c;
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
  if (!isTTY) {
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

    const result = yield* effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          clearInterval(interval);
          process.stderr.write(`\r${c.green("✓")} ${message}\n`);
        }),
      ),
    );

    return result;
  });
};

// ============================================================================
// Color Helpers (for tree views, status badges, etc.)
// ============================================================================

export const dim = (s: string) => getColors().dim(s);
export const bold = (s: string) => getColors().bold(s);
export const green = (s: string) => getColors().green(s);
export const yellow = (s: string) => getColors().yellow(s);
export const cyan = (s: string) => getColors().cyan(s);
export const red = (s: string) => getColors().red(s);
export const magenta = (s: string) => getColors().magenta(s);
