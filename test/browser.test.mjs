import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';
import {renderDailyPlan as renderPlan,repository,settingsFrom} from '../scripts/harness.mjs';
import fs from 'node:fs';
test('desktop browser exposes visible highlights and annotations; native computer use follows latest',()=>{
 const plan=renderPlan(path.join(os.tmpdir(),'browser capability home'),settingsFrom(path.join(repository,'config/local.example.json'),{}));
 const patch=JSON.parse(plan.get('profiles/desktop/cordis.patch.yml').replace(/!!js ("(?:[^"\\]|\\.)*")/g,'{"$js":$1}'));
 const rows=patch.flatMap(row=>[row,...(row.insert??[])]),browser=rows.find(row=>row.id==='isolated-browser');
 assert(browser.config.cli.endsWith('cli.js'));assert(browser.config.outputRoot.includes('isolated'));assert(plan.get('profiles/desktop/package.json').includes('@local/dsh-browser-review'));
 for(const id of ['computer-use','computer-use-native'])assert(rows.some(row=>row.id===id));
 const pkg=JSON.parse(plan.get('profiles/desktop/package.json'));assert.equal(pkg.dependencies['@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'],'${DSH_RUNTIME_VERSION}');assert(!pkg.dependencies['dsh-annotate']);
 assert(!plan.has('profiles/desktop/agent-capabilities/browser-guidance.mjs'));assert(!plan.get('profiles/headless/package.json').includes('cua-driver'));
 assert(!plan.has('profiles/desktop/agent-capabilities/skills/computer-use/SKILL.md'));
});
