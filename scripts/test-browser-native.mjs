import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

assert(['win32','darwin'].includes(process.platform),'Native browser regression requires Windows or macOS');
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = path.resolve(
  process.env.DSH_APP_DIR ??
    (process.platform==='darwin'?'/Applications/DeepSeek Harness.app':path.join(os.homedir(), "AppData/Local/Programs/DeepSeek Harness")),
);
const output = path.join(repository, ".local/browser-native-test"),
  runtime = path.join(output, "runtime");
assert(
  fs.existsSync(path.join(source, process.platform==='darwin'?'Contents/MacOS/DeepSeek Harness':'DeepSeek Harness.exe')),
  "Set DSH_APP_DIR to the installed Harness directory",
);
fs.mkdirSync(runtime, { recursive: true });
assert.equal(
  fs.realpathSync(runtime).toLowerCase(),
  path
    .join(fs.realpathSync(repository), ".local/browser-native-test/runtime")
    .toLowerCase(),
  "Native fixture runtime must remain inside its repository output",
);
assert.notEqual(
  fs.realpathSync(source).toLowerCase(),
  fs.realpathSync(runtime).toLowerCase(),
  "Native fixture source must differ from runtime",
);
if(process.platform==='win32')for (const entry of fs.readdirSync(source, { withFileTypes: true }))
  if (entry.isFile() && !entry.name.startsWith("Uninstall")) {
    const target = path.join(runtime, entry.name);
    const executable = entry.name.toLowerCase().endsWith(".exe");
    if (fs.existsSync(target)) {
      const original = fs.statSync(path.join(source, entry.name)),
        linked = fs.statSync(target);
      if (
        !executable &&
        original.dev === linked.dev &&
        original.ino === linked.ino
      )
        continue;
      fs.unlinkSync(target);
    }
    if (!fs.existsSync(target)) {
      try {
        // Windows shortcut tracking can retarget installed links to an executable hardlink.
        if (executable) fs.copyFileSync(path.join(source, entry.name), target);
        else fs.linkSync(path.join(source, entry.name), target);
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
        fs.copyFileSync(path.join(source, entry.name), target);
      }
    }
  }
if(process.platform==='win32')fs.mkdirSync(path.join(runtime, "locales"), { recursive: true });
if(process.platform==='win32')for (const name of ["en-US.pak", "zh-CN.pak"])
  if (fs.existsSync(path.join(source, "locales", name)))
    fs.copyFileSync(
      path.join(source, "locales", name),
      path.join(runtime, "locales", name),
    );
const macApp=path.join(runtime,'Browser acceptance.app');
if(process.platform==='darwin'){
  fs.cpSync(source,macApp,{recursive:true,verbatimSymlinks:true,mode:fs.constants.COPYFILE_FICLONE});
  fs.rmSync(path.join(macApp,'Contents/Resources/app.asar'),{force:true});
  execFileSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier local.dsh.browser-acceptance',path.join(macApp,'Contents/Info.plist')]);
}
const app = process.platform==='darwin'?path.join(macApp,'Contents/Resources/app'):path.join(runtime, "resources/app");
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
if (fs.existsSync(resultFile)) fs.renameSync(resultFile,resultFile+'.'+Date.now()+'.previous');
if(process.platform==='darwin')execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',macApp],{stdio:'pipe'});
const child = spawn(process.platform==='darwin'?path.join(macApp,'Contents/MacOS/DeepSeek Harness'):path.join(runtime, "DeepSeek Harness.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...env,
    DSH_REVIEW_USER_DATA: path.join(output, "user-data"),
    DSH_REVIEW_RESULT: resultFile,
    DSH_REVIEW_PROOF: path.join(output, "full-screen.png"),
    DSH_REVIEW_SCREENSHOT_PROOF: path.join(output, "screenshot.png"),
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
