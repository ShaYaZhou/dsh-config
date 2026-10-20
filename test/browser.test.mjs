import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';
import {renderPlan,repository,settingsFrom} from '../scripts/harness.mjs';
import fs from 'node:fs';import {pathToFileURL} from 'node:url';
test('desktop browser exposes visible highlights and annotations; native computer use is pinned',()=>{
 const plan=renderPlan(path.join(os.tmpdir(),'browser capability home'),settingsFrom(path.join(repository,'config/local.example.json'),{}));
 const patch=JSON.parse(plan.get('profiles/desktop/cordis.patch.yml').replace(/!!js ("(?:[^"\\]|\\.)*")/g,'{"$js":$1}'));
 const rows=patch.flatMap(row=>[row,...(row.insert??[])]),browser=rows.find(row=>row.id==='mcp-playwright');
 assert(!browser.config.args.includes('--headless'));assert(browser.config.args.includes('vision,devtools'));assert(browser.config.args.includes('--snapshot-boxes'));assert.equal(browser.config.toolCallTimeoutMs,600000);
 for(const id of ['computer-use','computer-use-native','browser-guidance'])assert(rows.some(row=>row.id===id));
 const pkg=JSON.parse(plan.get('profiles/desktop/package.json'));assert.equal(pkg.dependencies['@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'],'0.2.1-rc.2');assert(!pkg.dependencies['dsh-annotate']);
 assert(plan.has('profiles/desktop/agent-capabilities/browser-guidance.mjs'));assert(!plan.get('profiles/headless/package.json').includes('cua-driver'));
 assert(plan.has('profiles/desktop/agent-capabilities/skills/computer-use/SKILL.md'));
});

test('native desktop skill belongs to each Agent and is removed on unload',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-native-skill-'));
 const plan=renderPlan(home,settingsFrom(path.join(repository,'config/local.example.json'),{}));
 const modulePath=path.join(home,'profiles/desktop/agent-capabilities/browser-guidance.mjs');
 for(const relative of ['profiles/desktop/agent-capabilities/browser-guidance.mjs','profiles/desktop/agent-capabilities/skills/computer-use/SKILL.md']){const file=path.join(home,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,plan.get(relative));}
 const registered=[],handlers=new Map();let cleanup,disposed=0;
 const agent=id=>({id,ctx:{get:()=>({register:skill=>{registered.push({id,skill});return ()=>disposed++;}})}});
 const first=agent('first'),second=agent('second');
 try{
  const {apply}=await import(pathToFileURL(modulePath));apply({agents:{list:()=>[first]},systemPrompt:{section:()=>{}},on:(name,fn)=>handlers.set(name,fn),effect:fn=>{cleanup=fn();}});
  handlers.get('agent/created')({agent:first});handlers.get('agent/created')({agent:second});assert.equal(registered.length,2);
  assert.equal(registered[0].skill.source,'runtime');assert.equal(registered[0].skill.name,'computer-use');assert(!registered[0].skill.content.startsWith('---'));assert(registered[0].skill.content.includes('cua_driver_native__'));
  handlers.get('agent/disposed')({agent:first});assert.equal(disposed,1);cleanup();assert.equal(disposed,2);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
