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
});
