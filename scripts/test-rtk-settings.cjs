const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { withAgentTestHomeLock } = require("./test-home.cjs");
async function main() {
  const home = process.env.DSH_HOME,
    native = process.env.DSH_NATIVE_ROOT;
  const { runProfile } = await import(
    pathToFileURL(path.join(native, "dsh/lib/profile-boot.js"))
  );
  const { loadLayeredEnv } = await import(
    pathToFileURL(path.join(native, "dsh-app-boot/lib/index.js"))
  );
  const open = () =>
    runProfile({
      environment: loadLayeredEnv("dsh"),
      profile: "desktop",
      patchFiles: [],
      args: ["--port", "0", "--no-open"],
    });
  let runtime = await open(),
    ctx = runtime.ctx;
  let original;
  const entry = () =>
    ctx.configEditor.entries().find((e) => e.options.id === "rtk-rules");
  const edit = (value) => ctx.configEditor.edit(entry(), () => value);
  const probe = (command) =>
    ctx
      .get("rtkRules")
      .preview({
        command,
        dialect: process.platform === "win32" ? "pwsh" : "bash",
      });
  try {
    assert(entry(), "Settings entry missing");
    original = structuredClone(entry().options.config ?? {});
    assert(probe("git status").changed);
    await edit({ ...original, enabled: false });
    assert.equal(probe("git status").changed, false);
    await edit({ ...original, logs: false });
    assert.equal(probe("cat file.log").changed, false);
    assert(probe("git status").changed);
    const selected = {
      ...original,
      excludedCommands: ["git status"],
      customRules: [
        { command: "cargo check", filter: "summary", enabled: true },
      ],
    };
    await edit(selected);
    assert.equal(probe("git status").changed, false);
    assert(probe("cargo check").changed);
    assert.equal(probe("cargo check --all").changed, false);
    assert.equal(probe("git status; echo unsafe").changed, false);
    await runtime.shutdown.shutdown(0);
    runtime = await open();
    ctx = runtime.ctx;
    assert.equal(probe("git status").changed, false);
    assert(probe("cargo check").changed);
    await edit(original);
    assert(probe("git status").changed);
    console.log(
      "RTK_SETTINGS_PASS: native config edit, live toggles, exclusions, exact custom rule, restart persistence, restored defaults",
    );
  } finally {
    if (original && entry()) await edit(original);
    await runtime.shutdown.shutdown(0);
  }
}
withAgentTestHomeLock(process.env.DSH_HOME, main).catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
