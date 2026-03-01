import { mkdirSync, lstatSync, unlinkSync, symlinkSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as os from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const skillContent = readFileSync(join(rootDir, "skills", "stacked", "SKILL.md"), "utf-8");

console.log("Building stacked...");

const binDir = join(rootDir, "bin");
mkdirSync(binDir, { recursive: true });

const platform =
  process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";

const buildResult = await Bun.build({
  entrypoints: [join(rootDir, "src/main.ts")],
  target: "bun",
  minify: false,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __SKILL_CONTENT__: JSON.stringify(skillContent),
  },
  compile: {
    target: `bun-${platform}-${arch}`,
    outfile: join(binDir, "stacked"),
    autoloadBunfig: false,
  },
});

if (!buildResult.success) {
  console.error("Build failed:");
  for (const log of buildResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Binary built: ${join(binDir, "stacked")}`);

const home = process.env["HOME"] ?? os.homedir();
const bunBin = join(home, ".bun", "bin", "stacked");
try {
  try {
    lstatSync(bunBin);
    unlinkSync(bunBin);
  } catch {
    // doesn't exist
  }
  symlinkSync(join(binDir, "stacked"), bunBin);
  console.log(`Symlinked to: ${bunBin}`);
} catch (e) {
  console.log(`Could not symlink to ${bunBin}: ${e}`);
}
