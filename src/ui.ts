import pc from "picocolors";
import { Effect } from "effect";

// ============================================================================
// TTY & Color Detection
// ============================================================================

const isTTY = process.stderr.isTTY === true;

const colorEnabled = (() => {
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (process.env["FORCE_COLOR"] !== undefined) return true;
  if (process.env["TERM"] === "dumb") return false;
  return isTTY;
})();

const c = colorEnabled ? pc : pc.createColors(false);

// ============================================================================
// Styled Output (all write to stderr)
// ============================================================================

const write = (msg: string) =>
  Effect.sync(() => {
    process.stderr.write(msg + "\n");
  });

export const success = (msg: string) => write(c.green(`✓ ${msg}`));
export const warn = (msg: string) => write(c.yellow(`⚠ ${msg}`));
export const info = (msg: string) => write(c.cyan(msg));
export const error = (msg: string) => write(c.red(msg));

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

export const dim = (s: string) => c.dim(s);
export const bold = (s: string) => c.bold(s);
export const green = (s: string) => c.green(s);
export const yellow = (s: string) => c.yellow(s);
export const cyan = (s: string) => c.cyan(s);
export const red = (s: string) => c.red(s);
export const magenta = (s: string) => c.magenta(s);
