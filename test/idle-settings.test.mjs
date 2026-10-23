import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Config, ratioOf } from '../plugins/idle-settings/lib/index.js';

function fixture({write, unset = async () => true, threshold = {}} = {}) {
  let plugin,page,cleanup;
  const updates=[];
  const React={createElement:(type,props,...children)=>({type,props,children}),useSyncExternalStore:(_subscribe,get)=>get(),useState:initial=>[initial,value=>updates.push(value)],useRef:value=>({current:value}),useEffect:effect=>{const result=effect();if(typeof result==='function')cleanup=result;}};
  vm.runInNewContext(fs.readFileSync(new URL('../plugins/idle-settings/lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:entry=>{plugin=entry.factory(name=>name==='react'?React:{Switch:'native-switch',Button:'native-button'});}}}});
  const idleForm={getSnapshot:()=>({status:'ready',writable:true,value:{enabled:true}}),subscribe:()=>()=>{},set:write};
  const thresholdSnapshot={status:'ready',writable:true,value:{thresholdPercent:80},base:{thresholdPercent:80},user:{},...threshold};
  const thresholdForm={getSnapshot:()=>thresholdSnapshot,subscribe:()=>()=>{},set:write,unset};
  plugin.apply({effect:effect=>effect(),configForms:{get:namespace=>{assert.ok(namespace==='idle-compaction'||namespace==='idle-settings');return namespace==='idle-compaction'?idleForm:thresholdForm;},whileServed:(names,register)=>{assert.deepEqual([...names],['idle-compaction','idle-settings']);return register(new Set(names));}},slots:{inject:(_name,register)=>register(),register:(options,component)=>{assert.equal(options.name,'settings.enhancement.panel');page=component;return()=>{};}}});
  const tree=page();
  const find=(type,node=tree)=>node?.type===type?node:node?.children?.map(child=>find(type,child)).find(Boolean);
  return {tree,updates,switchControl:find('native-switch'),button:find('native-button'),input:find('input'),unmount:()=>cleanup?.()};
}

function textOf(node) {
  if (typeof node === 'string') return node;
  return [node?.children ?? []].flat(Infinity).map(textOf).join('');
}

test('idle settings use the native shared form and surface a refused write',async()=>{
  const calls=[];const f=fixture({write:async(...args)=>{calls.push(args);return false;}});
  assert.equal(f.switchControl.props.checked,true);assert.equal(f.switchControl.props.disabled,false);
  await f.switchControl.props.onChange(false);assert.deepEqual(calls,[['enabled',false]]);assert(f.updates.includes('保存未成功，请重试。'));
});

test('closing the settings page does not publish state from a later write settlement',async()=>{
  let settle;const f=fixture({write:()=>new Promise(resolve=>{settle=resolve;})});
  const pending=f.switchControl.props.onChange(false);f.unmount();const count=f.updates.length;settle(true);await pending;assert.equal(f.updates.length,count);
});

test('compaction threshold commits the typed percentage and shows the default',async()=>{
  const calls=[];const f=fixture({write:async(...args)=>{calls.push(args);return true;}});
  assert.equal(f.input.props.value,'80');
  assert.match(f.tree.children.map(textOf).join(' '),/默认 80%/);
  await f.input.props.onBlur({target:{value:'65'}});
  assert.deepEqual(calls,[['thresholdPercent',65]]);
});

test('out-of-range percentages are rejected before writing',async()=>{
  const calls=[];const f=fixture({write:async(...args)=>{calls.push(args);return true;}});
  await f.input.props.onBlur({target:{value:'10'}});
  assert.deepEqual(calls,[]);
  assert(f.updates.some(value=>typeof value==='string'&&value.includes('20–100')));
  assert.equal(f.input.props.value,'80');
});

test('restore-default button is only enabled for an override and clears it',async()=>{
  const calls=[];const untouched=fixture({write:async()=>true});
  assert.equal(untouched.button.props.disabled,true);
  const f=fixture({write:async(...args)=>{calls.push(args);return true;},unset:async(...args)=>{calls.push(args);return true;},threshold:{value:{thresholdPercent:65},user:{thresholdPercent:65}}});
  assert.equal(f.button.props.disabled,false);
  await f.button.props.onClick();
  assert.deepEqual(calls,[['thresholdPercent']]);
});

test('backend exposes the configured ratio and the native 80% default',async()=>{
  assert.equal(ratioOf({thresholdPercent:65}),0.65);
  assert.equal(ratioOf({thresholdPercent:{get:()=>70}}),0.7);
  assert.equal(ratioOf({}),undefined);
  assert.equal(Config({}).thresholdPercent.get(),80);
});
