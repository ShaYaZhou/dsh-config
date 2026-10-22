const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const test = require("node:test"),
  assert = require("node:assert/strict");

function client() {
  let exported;
  const code = fs
    .readFileSync(
      path.resolve(__dirname, "../plugins/file-links/lib/client.js"),
      "utf8",
    )
    .replace(
      "return { inject, apply };",
      "return { inject, apply, parsePathRef, install };",
    );
  vm.runInNewContext(code, {
    window: {
      __ModuleLoader__: {
        load: (entry) => {
          exported = entry.factory(() => ({}));
        },
      },
    },
  });
  return exported;
}

test("workspace paths and line anchors are recognized without touching disk", () => {
  const { parsePathRef } = client();
  const drive = ["C", ":", "\\repo\\a.md"].join("");
  for (const [value, expected] of [
    ["src/main.ts", { path: "src/main.ts", line: undefined }],
    ["src/main.ts:42", { path: "src/main.ts", line: 42 }],
    ["src/main.ts#L42", { path: "src/main.ts", line: 42 }],
    ["src/main.ts:42-60", { path: "src/main.ts", line: 42 }],
    [drive, { path: drive, line: undefined }],
    ["/usr/local/x.txt", { path: "/usr/local/x.txt", line: undefined }],
    ["./a/b.c", { path: "./a/b.c", line: undefined }],
    ["../a/b.c", { path: "../a/b.c", line: undefined }],
    ["README.md", { path: "README.md", line: undefined }],
    [".env", { path: ".env", line: undefined }],
    ["plugins/file-links", { path: "plugins/file-links", line: undefined }],
  ])
    assert.deepEqual({ ...parsePathRef(value) }, expected, value);
});

test("prose, urls, directories and bare words stay plain text", () => {
  const { parsePathRef } = client();
  for (const value of [
    undefined,
    "",
    " has space ",
    "new\nline",
    "https://example.com/a.ts",
    "//server/share",
    "\\\\server\\share",
    "`a.ts`",
    '"a.ts"',
    "<a.ts>",
    "a.ts|b.ts",
    "and/or",
    "src",
    "docs/",
    "src/",
    ".",
    "..",
    "3.5",
    "v1.2",
    "e.g",
    "i.e",
    "a.b",
    "foo:12",
  ])
    assert.equal(parsePathRef(value), undefined, String(value));
});

test("resolved paths reuse the deliverables result and open in the sidebar preview", () => {
  const { install } = client();
  const produced = { open() {}, label: "made.ts", title: "made.ts" };
  const service = {
    forClosing: (owner, sessionId) => ({
      resolve: (value) => (value === "made.ts" ? produced : undefined),
    }),
  };
  const original = service.forClosing;
  const opened = [];
  const owner = { openFile: (...args) => opened.push(args) };
  const dispose = install(service);

  const resolver = service.forClosing(owner, "session");
  assert.equal(resolver.resolve("made.ts"), produced);
  assert.equal(resolver.resolve("and/or"), undefined);
  assert.equal(
    service.forClosing(undefined, "session").resolve("src/a.ts"),
    undefined,
  );

  const hit = resolver.resolve("src/a.ts:7");
  assert.equal(hit.label, "src/a.ts");
  assert.equal(hit.title, "src/a.ts");
  hit.open();
  assert.equal(opened[0][0], "src/a.ts");
  assert.equal(opened[0][1].line, 7);

  resolver.resolve("README.md").open();
  assert.equal(opened[1][0], "README.md");
  assert.equal(opened[1][1], undefined);

  dispose();
  assert.equal(service.forClosing, original);
});

test("the plugin waits for the native file mention service", () => {
  const { inject, apply } = client();
  assert.equal(inject.length, 1);
  assert.equal(inject[0], "chatFileMentions");
  const cleanups = [];
  const service = { forClosing: () => ({ resolve: () => undefined }) };
  const ctx = {
    get: (name) => (name === "chatFileMentions" ? service : undefined),
    effect: (fn) => cleanups.push(fn()),
  };
  apply(ctx);
  assert.equal(cleanups.length, 1);
  const opened = [];
  const owner = { openFile: (...args) => opened.push(args) };
  service.forClosing(owner, "s").resolve("README.md").open();
  assert.equal(opened[0][0], "README.md");
  assert.equal(opened[0][1], undefined);
  cleanups.forEach((cleanup) => cleanup());
});
