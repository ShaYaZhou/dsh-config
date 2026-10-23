const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const test = require("node:test"),
  assert = require("node:assert/strict");

function client() {
  let exported;
  const code = fs
    .readFileSync(
      path.resolve(__dirname, "../plugins/team-view/lib/client.js"),
      "utf8",
    )
    .replace(
      "return { inject, apply };",
      "return { inject, apply, teamOf, memberRows, chatAddress };",
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

const team = {
  members: [
    { id: "lead-1", name: "lead", role: "lead", phase: "active" },
    { id: "child-1", name: "worker", role: "teammate", phase: "active" },
  ],
  tasks: [
    { ownerName: "worker", status: "in_progress" },
    { ownerName: "worker", status: "completed" },
  ],
  plans: [
    { id: "plan-1", authorName: "worker", status: "pending" },
    { id: "plan-2", authorName: "worker", status: "approved" },
  ],
};

test("a selected Lead or teammate Session resolves to its Team view", () => {
  const { teamOf } = client();
  const list = {
    byId: {
      "lead-1": { id: "lead-1", projectionValues: { agentTeam: team } },
      "child-1": { id: "child-1", parentId: "lead-1" },
    },
  };
  assert.equal(teamOf(list, "lead-1"), team);
  assert.equal(teamOf(list, "child-1"), team);
  // useSyncExternalStore requires the empty snapshot to be reference-stable.
  assert.equal(teamOf(list, undefined), teamOf({ byId: {} }, "missing"));
  for (const empty of [
    teamOf(list, undefined),
    teamOf({ byId: {} }, "missing"),
  ]) {
    assert.equal(empty.members.length, 0);
    assert.equal(empty.tasks.length, 0);
    assert.equal(empty.plans.length, 0);
  }
});

test("teammate rows carry their working task and pending plan counts", () => {
  const { memberRows } = client();
  const rows = memberRows(team);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "child-1");
  assert.equal(rows[0].name, "worker");
  assert.equal(rows[0].phase, "active");
  assert.equal(rows[0].working, 1);
  assert.equal(rows[0].pendingPlans, 1);
  assert.equal(memberRows({ members: [], tasks: [], plans: [] }).length, 0);
});

test("a member opens through the native subagent chat resource address", () => {
  const { chatAddress } = client();
  assert.equal(
    chatAddress({
      parentSessionId: "lead-1",
      childSessionId: "child 1",
      mode: "continuable",
    }),
    "dsh-resource://subagentchat/session/child%201?parent=lead-1&mode=continuable",
  );
});
