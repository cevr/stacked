import { Command, Flag } from "effect/unstable/cli";
import { Config, Console, Effect } from "effect";
import { StackError } from "../errors/index.js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const skillContent = typeof __SKILL_CONTENT__ !== "undefined" ? __SKILL_CONTENT__ : null;

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const init = Command.make("init", { json: jsonFlag }).pipe(
  Command.withDescription("Install the stacked Claude skill to ~/.claude/skills"),
  Command.withExamples([{ command: "stacked init", description: "Install the Claude skill" }]),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      if (skillContent === null) {
        return yield* new StackError({
          message: "Skill content not available. This command only works with the compiled binary.",
        });
      }

      const skillsDir = yield* Config.string("STACKED_SKILLS_DIR").pipe(
        Config.withDefault(join(homedir(), ".claude", "skills")),
      );
      const targetDir = join(skillsDir, "stacked");
      const targetPath = join(targetDir, "SKILL.md");

      if (!json) {
        yield* Console.error(`Writing skill to ${targetPath}...`);
      }
      yield* Effect.try({
        try: () => {
          mkdirSync(targetDir, { recursive: true });
          writeFileSync(targetPath, skillContent);
        },
        catch: (e) => new StackError({ message: `Failed to write skill: ${e}` }),
      });

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ path: targetPath }, null, 2));
      } else {
        yield* Console.error(`Installed stacked skill to ${targetPath}`);
        yield* Console.error("\nNext steps:");
        yield* Console.error("  stacked create <name>  # start your first stack");
        yield* Console.error(
          "  stacked trunk <name>   # only if auto-detection picks the wrong trunk",
        );
      }
    }),
  ),
);
