import { Command } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { StackError } from "../errors/index.js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const skillContent = typeof __SKILL_CONTENT__ !== "undefined" ? __SKILL_CONTENT__ : null;

export const init = Command.make("init").pipe(
  Command.withDescription("Install the stacked Claude skill to ~/.claude/skills"),
  Command.withExamples([{ command: "stacked init", description: "Install the Claude skill" }]),
  Command.withHandler(() =>
    Effect.gen(function* () {
      if (skillContent === null) {
        return yield* new StackError({
          message: "Skill content not available. This command only works with the compiled binary.",
        });
      }

      const skillsDir = process.env["STACKED_SKILLS_DIR"] ?? join(homedir(), ".claude", "skills");
      const targetDir = join(skillsDir, "stacked");
      const targetPath = join(targetDir, "SKILL.md");

      yield* Console.error(`Writing skill to ${targetPath}...`);
      yield* Effect.try({
        try: () => {
          mkdirSync(targetDir, { recursive: true });
          writeFileSync(targetPath, skillContent);
        },
        catch: (e) => new StackError({ message: `Failed to write skill: ${e}` }),
      });

      yield* Console.error(`Installed stacked skill to ${targetPath}`);
      yield* Console.error("\nNext steps:");
      yield* Console.error("  stacked trunk          # verify/set your trunk branch");
      yield* Console.error("  stacked create <name>  # start your first stack");
    }),
  ),
);
