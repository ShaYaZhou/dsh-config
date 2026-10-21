import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function fixture(write) {
  let plugin,page,cleanup;
  const updates=[];
  const React={createElement:(type,props,...children)=>({type,props,children}),useSyncExternalStore:(_subscribe,get)=>get(),useState:initial=>[initial,value=>updates.push(value)],useRef:value=>({current:value}),useEffect:effect=>{cleanup=effect();}};
  vm.runInNewContext(fs.readFileSync(new URL('../plugins/idle-settings/lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:entry=>{plugin=entry.factory(name=>name==='react'?React:{Switch:'native-switch'});}}}});
  const form={getSnapshot:()=>({status:'ready',writable:true,value:{enabled:true}}),subscribe:()=>()=>{},set:write};
  plugin.apply({effect:effect=>effect(),configForms:{get:namespace=>{assert.equal(namespace,'idle-compaction');return form;},whileServed:(names,register)=>{assert.deepEqual([...names],['idle-compaction']);return register(new Set(names));}},slots:{inject:(_name,register)=>register(),register:(options,component)=>{assert.equal(options.name,'settings.section');page=component;return()=>{};}}});
  const tree=page();
  const find=node=>node?.type==='native-switch'?node:node?.children?.map(find).find(Boolean);
  const control=find(tree);
  return {control,updates,unmount:()=>cleanup()};
}

test('idle settings use the native shared form and surface a refused write',async()=>{
  const calls=[];const f=fixture(async(...args)=>{calls.push(args);return false;});
  assert.equal(f.control.props.checked,true);assert.equal(f.control.props.disabled,false);
  await f.control.props.onChange(false);assert.deepEqual(calls,[['enabled',false]]);assert(f.updates.includes('保存未成功，请重试。'));
});

test('closing the settings page does not publish state from a later write settlement',async()=>{
  let settle;const f=fixture(()=>new Promise(resolve=>{settle=resolve;}));
  const pending=f.control.props.onChange(false);f.unmount();const count=f.updates.length;settle(true);await pending;assert.equal(f.updates.length,count);
});
