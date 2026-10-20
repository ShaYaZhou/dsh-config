import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

assert.equal(
  process.platform,
  "win32",
  "This regression requires the verified Windows Electron runtime",
);
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = path.resolve(
  process.env.DSH_APP_DIR ??
    path.join(os.homedir(), "AppData/Local/Programs/DeepSeek Harness"),
);
const output = path.join(repository, ".local/browser-native-test"),
  runtime = path.join(output, "runtime");
assert(
  fs.existsSync(path.join(source, "DeepSeek Harness.exe")),
  "Set DSH_APP_DIR to the installed Harness directory",
);
fs.mkdirSync(runtime, { recursive: true });
for (const entry of fs.readdirSync(source, { withFileTypes: true }))
  if (entry.isFile() && !entry.name.startsWith("Uninstall")) {
    const target = path.join(runtime, entry.name);
    if (fs.existsSync(target)) {
      const original = fs.statSync(path.join(source, entry.name)), linked = fs.statSync(target);
      if (original.dev === linked.dev && original.ino === linked.ino) continue;
      fs.unlinkSync(target);
    }
    if (!fs.existsSync(target)) {
      try {
        fs.linkSync(path.join(source, entry.name), target);
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
        fs.copyFileSync(path.join(source, entry.name), target);
      }
    }
  }
fs.mkdirSync(path.join(runtime, "locales"), { recursive: true });
for (const name of ["en-US.pak", "zh-CN.pak"])
  if (fs.existsSync(path.join(source, "locales", name)))
    fs.copyFileSync(
      path.join(source, "locales", name),
      path.join(runtime, "locales", name),
    );
const app = path.join(runtime, "resources/app");
fs.mkdirSync(app, { recursive: true });
fs.writeFileSync(
  path.join(app, "package.json"),
  JSON.stringify({
    name: "dsh-browser-native-test",
    version: "1.0.0",
    main: "main.cjs",
  }),
);
for (const name of ["main.cjs", "preload.cjs", "index.html"])
  fs.copyFileSync(
    path.join(repository, "test/browser-native", name),
    path.join(app, name),
  );
fs.copyFileSync(
  path.join(repository, "plugins/browser-review/lib/client.js"),
  path.join(app, "review.js"),
);
const resultFile = path.join(output, "result.json"),
  env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
const child = spawn(path.join(runtime, "DeepSeek Harness.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...env,
    DSH_REVIEW_USER_DATA: path.join(output, "user-data"),
    DSH_REVIEW_RESULT: resultFile,
    DSH_REVIEW_PROOF: path.join(output, "full-screen.png"),
    DSH_REVIEW_PNG: path.join(output, "annotation.png"),
  },
});
const watchdog = setTimeout(() => child.kill(), 60000);
child.on("error", (error) => {
  clearTimeout(watchdog);
  throw error;
});
child.on("exit", (code) => {
  clearTimeout(watchdog);
  assert.equal(
    code,
    0,
    "Native browser regression failed: " +
      (fs.existsSync(resultFile)
        ? fs.readFileSync(resultFile, "utf8")
        : "no result"),
  );
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert(result.pass, JSON.stringify(result));
  console.log("BROWSER_NATIVE_PASS " + JSON.stringify(result));
});
