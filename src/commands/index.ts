import { Command } from "effect/unstable/cli";
import { trunk } from "./trunk.js";
import { create } from "./create.js";
import { list } from "./list.js";
import { stacks } from "./stacks.js";
import { checkout } from "./checkout.js";
import { top } from "./top.js";
import { bottom } from "./bottom.js";
import { sync } from "./sync.js";
import { deleteCmd } from "./delete.js";
import { submit } from "./submit.js";
import { adopt } from "./adopt.js";
import { log } from "./log.js";

const root = Command.make("stacked").pipe(
  Command.withDescription("Branch-based stacked PR manager"),
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
    sync,
    deleteCmd,
    submit,
    adopt,
    log,
  ]),
);
