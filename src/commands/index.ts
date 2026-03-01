import { Command } from "effect/unstable/cli";
import { trunk } from "./trunk.js";
import { create } from "./create.js";
import { list } from "./list.js";
import { stacks } from "./stacks.js";
import { checkout } from "./checkout.js";
import { top } from "./top.js";
import { bottom } from "./bottom.js";
import { up } from "./up.js";
import { down } from "./down.js";
import { sync } from "./sync.js";
import { deleteCmd } from "./delete.js";
import { submit } from "./submit.js";
import { adopt } from "./adopt.js";
import { log } from "./log.js";
import { clean } from "./clean.js";
import { detect } from "./detect.js";
import { init } from "./init.js";
import { status } from "./status.js";
import { doctor } from "./doctor.js";
import { rename } from "./rename.js";
import { reorder } from "./reorder.js";
import { split } from "./split.js";
import { amend } from "./amend.js";

const root = Command.make("stacked").pipe(
  Command.withDescription(
    "Branch-based stacked PR manager\n\nGlobal flags:\n  --verbose       Show detailed output\n  --quiet, -q     Suppress non-essential output\n  --no-color      Disable color output\n  --yes, -y       Skip confirmation prompts",
  ),
  Command.withExamples([
    { command: "stacked create feat-auth", description: "Create a new branch in the stack" },
    { command: "stacked list", description: "Show branches in the current stack" },
    { command: "stacked sync", description: "Rebase all branches in order" },
    { command: "stacked submit", description: "Push and create/update PRs" },
  ]),
);

export const command = root.pipe(
  Command.withSubcommands([
    trunk,
    create,
    list,
    stacks,
    checkout,
    top,
    bottom,
    up,
    down,
    sync,
    deleteCmd,
    submit,
    adopt,
    log,
    clean,
    detect,
    init,
    status,
    doctor,
    rename,
    reorder,
    split,
    amend,
  ]),
);
