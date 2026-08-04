#!/usr/bin/env node

const { Command } = require("commander");
const { login } = require("./lib/auth");
const { exportBoard, exportTask } = require("./lib/export");
const {
  setChromiumPath,
  setProjectId,
  getProjectId,
  DEFAULT_BASE_URL,
} = require("./lib/session-store");

const program = new Command();

program
  .command("login")
  .description("Open a browser window to log in and save your session")
  .action(async () => {
    try {
      const sessionPath = await login({
        loginUrl: DEFAULT_BASE_URL + "/login",
      });
      console.log(`✅ Logged in. Session saved to ${sessionPath}`);
    } catch (err) {
      console.error("❌ Login failed or timed out:", err.message);
      process.exit(1);
    }
  });

program
  .command("chromium <path>")
  .description("Set the path to the Chromium executable")
  .action((path) => {
    setChromiumPath(path);
    console.log(`Chromium path saved: ${path}`);
  });

program
  .command("project [id]")
  .description("Get or set the active project ID")
  .action((id) => {
    if (id) {
      setProjectId(id);
      console.log(`✅ Active project set to ${id}`);
    } else {
      const current = getProjectId();
      console.log(
        current
          ? `Active project: ${current}`
          : "No project set. Run `scrumboard-cli project <id>`.",
      );
    }
  });

program
  .command("export")
  .description("Export the active project's board to JSON")
  .option("-d, --details", "Include card details")
  .option("-o, --out <path>", "Output file or directory")
  .option("--headed", "Run the browser with a visible window")
  .action(async (options) => {
    const start = performance.now();
    try {
      const outFile = await exportBoard({
        details: options.details,
        out: options.out,
        headed: options.headed,
      });
      const s = (performance.now() - start).toFixed(0) / 1000;
      console.log(`✅ ${outFile} [${s}s]`);
    } catch (err) {
      console.error("❌ Export failed:", err.message);
      process.exit(1);
    }
  });

program
  .command("task <query>")
  .description("Export a single task whose name contains <query>")
  .option("-d, --details", "Include card details")
  .option("-o, --out <path>", "Output directory")
  .option("--headed", "Run the browser with a visible window")
  .option(
    "--include-acs",
    "Include the AC's metioned in task description, will also include card details",
  )
  .action(async (query, options) => {
    const start = performance.now();
    try {
      const outFile = await exportTask(query, {
        details: options.details,
        out: options.out ?? "./",
        headed: options.headed,
        includeAcs: options.includeAcs,
      });
      const s = (performance.now() - start).toFixed(0) / 1000;
      console.log(`✅ ${outFile} [${s}s]`);
    } catch (err) {
      console.error("❌ Export failed:", err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
