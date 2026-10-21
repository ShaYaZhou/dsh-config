const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const test = require("node:test");

test("verification recovery keeps its pointer on boot failure and refuses replay after rollback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-worktree-proof-"));
  const scripts = path.join(root, "scripts"),
    output = path.join(root, ".local/worktree-delivery-test");
  fs.mkdirSync(scripts);
  fs.mkdirSync(output, { recursive: true });
  for (const file of [
    "test-worktree-delivery.cjs",
    "test-home.cjs",
    "test-output-lock.cjs",
  ])
    fs.copyFileSync(
      path.join(__dirname, "../scripts", file),
      path.join(scripts, file),
    );
  const previous = {
    project: path.join(output, "project-fixture"),
    parentSessionId: "session-fixture",
    baseline: "fixture-base",
    oracleHash: "fixture-oracle",
    agentsHash: "fixture-instructions",
  };
  const pointer = path.join(output, "failure.json");
  fs.writeFileSync(pointer, JSON.stringify(previous));
  const run = () =>
    spawnSync(
      process.execPath,
      [path.join(scripts, "test-worktree-delivery.cjs")],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENAI_API_KEY: "synthetic",
          DSH_HOME: path.join(root, "home"),
          DSH_NATIVE_ROOT: path.join(root, "missing-native"),
          DSH_WORKTREE_VERIFY_LAST: "1",
        },
      },
    );
  try {
    const failedBoot = run();
    assert.equal(failedBoot.status, 1);
    assert.match(failedBoot.stderr, /missing-native/);
    assert.deepEqual(JSON.parse(fs.readFileSync(pointer, "utf8")), previous);
    fs.writeFileSync(
      path.join(output, "rollback-started.json"),
      JSON.stringify({ project: previous.project }),
    );
    const afterRollback = run();
    assert.equal(afterRollback.status, 1);
    assert.match(afterRollback.stderr, /Rollback already started/);
    assert.deepEqual(JSON.parse(fs.readFileSync(pointer, "utf8")), previous);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("dsh-worktree-proof-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
