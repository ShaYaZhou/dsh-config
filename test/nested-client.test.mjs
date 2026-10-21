import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

test("nested tree preserves sibling ordering, descendants and orphan history without cycling", () => {
  let plugin;
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../plugins/nested-sessions/lib/client.js", import.meta.url),
      "utf8",
    ),
    {
      window: {
        __ModuleLoader__: {
          load: (entry) => {
            plugin = entry.factory(() => ({}));
          },
        },
      },
    },
  );
  const rows = [
    { id: "parent" },
    { id: "a", updatedAt: 1 },
    { id: "b", updatedAt: 2 },
    { id: "grandchild" },
  ];
  const result = plugin.familyTree(
    [
      { sessionId: "a", parentId: "parent" },
      { sessionId: "b", parentId: "parent" },
      { sessionId: "grandchild", parentId: "a" },
      { sessionId: "missing", parentId: "a" },
    ],
    rows,
  );
  assert.deepEqual([...result.roots], ["parent"]);
  assert.deepEqual([...result.children.get("parent")], ["b", "a"]);
  assert.equal(result.parents.get("grandchild"), "a");
  assert.equal(result.parents.has("missing"), false);
  const cycle = plugin.familyTree(
    [
      { sessionId: "a", parentId: "b" },
      { sessionId: "b", parentId: "a" },
    ],
    rows,
  );
  assert.equal(cycle.roots.length, 1);
  assert.equal(cycle.parents.size, 1);
  const focus = plugin.familyTree(
    [
      { sessionId: "a", parentId: "parent" },
      { sessionId: "grandchild", parentId: "a" },
    ],
    [...rows, { id: "new-root" }],
    "new-root",
  );
  assert.deepEqual([...focus.roots], ["new-root", "parent"]);
  const childFocus = plugin.familyTree(
    [
      { sessionId: "a", parentId: "parent" },
      { sessionId: "grandchild", parentId: "a" },
    ],
    rows,
    "grandchild",
  );
  assert.deepEqual([...childFocus.roots], ["parent"]);
  assert.equal(childFocus.parents.get("grandchild"), "a");
  const visible = plugin.sidebarRows(
    ["a", "unrelated", "parent", "grandchild"],
    [
      { sessionId: "a", parentId: "parent" },
      { sessionId: "grandchild", parentId: "a" },
    ],
    new Set(["parent"]),
  );
  assert.deepEqual(
    Array.from(visible, (row) => [row.id, row.depth, row.hidden]),
    [
      ["parent", 0, false],
      ["a", 1, true],
      ["grandchild", 2, true],
      ["unrelated", 0, false],
    ],
  );
  const orphan = plugin.sidebarRows(
    ["a", "unrelated"],
    [{ sessionId: "a", parentId: "missing" }],
  );
  assert.deepEqual(
    Array.from(orphan, (row) => [row.id, row.depth, row.hidden]),
    [
      ["a", 0, false],
      ["unrelated", 0, false],
    ],
  );
  const linked = [{ sessionId: "a", parentId: "parent" }];
  assert.equal(
    plugin.hasPartialFamily(["a"], linked, new Set(["a", "parent"])),
    true,
  );
  assert.equal(
    plugin.hasPartialFamily(["a", "parent"], linked, new Set(["a", "parent"])),
    false,
  );
  assert.equal(plugin.hasPartialFamily(["a"], linked, new Set(["a"])), false);
  const registrations = [];
  plugin.apply({
    effect: () => {},
    slots: {
      inject: (_name, callback) => {
        const result = callback();
        if (result?.next)
          for (const _ of result) {
          }
      },
      register: (options) => {
        registrations.push(options);
        return () => {};
      },
    },
  });
  assert.deepEqual(
    registrations.map((row) => row.name),
    ["conversation.session.header.actions","main"],
  );
});
