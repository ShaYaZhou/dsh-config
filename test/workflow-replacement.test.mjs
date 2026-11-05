import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderDailyPlan,settingsFrom,repository} from '../scripts/harness.mjs';
import path from 'node:path';
import os from 'node:os';

test('workflow replaces linked orchestration without restoring enhanced policy',()=>{
  const plan=renderDailyPlan(path.join(os.tmpdir(),'workflow-replacement'),settingsFrom('/nonexistent'));
  const pkg=JSON.parse(plan.get('profiles/desktop/package.json'));
  assert(!pkg.dependencies['@dsh-external/workflow']);
  assert(!pkg.dsh.profile.bundles.includes('@dsh-external/workflow'));
  for(const name of ['nested-sessions','follow-ups','workflow-ptc','tool-workflow'])
    assert(!pkg.dependencies['@local/dsh-'+name]);
  assert(![...plan.keys()].some(key=>key.includes('dsh-spec-delivery')));
  for (const name of ['session-bus','usage-report']) {
    assert(![...plan.keys()].some(key=>key.includes(name)));
    assert(!plan.get('profiles/desktop/cordis.patch.yml').includes(name));
  }
  assert(pkg.dependencies['@local/dsh-dynamic-ui-view']);
  assert(pkg.dependencies['@local/dsh-browser-review']);
  assert(!pkg.dependencies['dsh-subagent-workspace-ui']);
  for(const file of ['worktree.mjs','worktree-tools.mjs','browser-guidance.mjs']) assert(![...plan.keys()].some(key=>key.endsWith('/'+file)));
  for (const name of ['local-environments','team-view']) assert(!pkg.dependencies['@local/dsh-'+name]);
});

test('Workflow and Hooks retain upstream versions and no local compatibility adapter',()=>{
 const provenance=JSON.parse(fs.readFileSync(path.join(repository,'provenance.json'),'utf8'));
 for(const id of ['external-workflow','codex-hooks']){
  const entry=provenance.plugins.find(row=>row.id===id);
  const pkg=JSON.parse(fs.readFileSync(path.join(repository,'plugins',id,'package.json'),'utf8'));
  assert.equal(entry.localChanges,false);assert.equal(pkg.version,entry.version);
  assert(!pkg.version.includes('local'));
 }
 assert(!fs.existsSync(path.join(repository,'plugins/external-workflow/lib/rc5-subagents.js')));
});
