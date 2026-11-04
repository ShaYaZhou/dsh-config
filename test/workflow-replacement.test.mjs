import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderDailyPlan,settingsFrom,repository} from '../scripts/harness.mjs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';

test('workflow replaces linked orchestration without restoring enhanced policy',()=>{
  const plan=renderDailyPlan(path.join(os.tmpdir(),'workflow-replacement'),settingsFrom('/nonexistent'));
  const pkg=JSON.parse(plan.get('profiles/desktop/package.json'));
  assert(pkg.dependencies['@dsh-external/workflow']);
  assert(pkg.dsh.profile.bundles.includes('@dsh-external/workflow'));
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

test('rc5 adapter persists restrictions before activation and restores them on cold load',async()=>{
  const source=fs.readFileSync(path.join(repository,'plugins/external-workflow/lib/rc5-subagents.js'),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replaceAll('export function','function');
  const scope={randomUUID:()=> 'fixture',SessionId:id=>id,appendPluginRecord:(session,type,data)=>session.events.push({type,data})};
  vm.runInNewContext(source+'\nthis.adapt=rc5Subagents;',scope);
  let hook,restricted,flushed=false,disposed=0;
  const child={id:'session-fixture',ctx:{tools:{restrict:value=>{restricted=value;}}},session:{events:[],snapshotEvents(){return this.events;}}};
  const ctx={on:(_name,fn)=>{hook=fn;},sessions:{flush:async()=>{flushed=true;}},agents:{get:()=>child},logger:{warn:()=>{}},subagents:{
    getProvider:()=>({capabilities:{},prepareContinuable(){}}),
    startActivation:async spec=>{
      assert.equal(spec.delivery,'caller');assert(!('toolFilter' in spec.request));
      await hook({agent:child});assert(flushed);assert.deepEqual(restricted,{allow:['read']});
      return {childId:child.id,result:Promise.resolve({stopReason:'completed'}),dispose:async()=>{disposed++;}};
    },
  }};
  const adapter=scope.adapt(ctx);
  const run=await adapter.start('spawn',{parent:{id:'parent'},prompt:[],signal:new AbortController().signal,toolFilter:{allow:['read']}});
  assert.equal((await run.result).stopReason,'completed');await run.dispose();assert.equal(disposed,1);
  restricted=undefined;scope.adapt(ctx);await hook({agent:child});assert.deepEqual(restricted,{allow:['read']});
  child.session.events[0].data={allow:'invalid'};
  await assert.rejects(hook({agent:child}),/Invalid persisted/);
});
