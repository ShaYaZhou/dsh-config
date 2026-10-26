import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

test('嵌套会话 control defaults auto, writes selected mode, and reports rejected changes', async () => {
 const source=fs.readFileSync(new URL('../plugins/nested-sessions/lib/client.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('    function CollaborateControl'),source.indexOf('    function apply(ctx)'));
 const values=[],effects=[];let cursor=0,poll,resolvePoll,defer=false;
 const React={
  useState:init=>{const i=cursor++;if(!(i in values))values[i]=init;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},
  useRef:init=>{const i=cursor++;return values[i]??=( {current:init});},
  useEffect:fn=>{if(!effects.length)effects.push(fn);},
 };
 const scope={React,h:(type,props,...children)=>({type,props,children}),AbortController,setInterval:fn=>{poll=fn;return 1;},clearInterval:()=>{}};
 vm.createContext(scope);vm.runInContext(code+'\nthis.Component=CollaborateControl;',scope);
 const writes=[];let reject=false;
 const props={readMode:async()=> defer?new Promise(resolve=>{resolvePoll=resolve;}):'auto',setMode:async mode=>{writes.push(mode);if(reject)throw new Error('not ready');}};
 const render=()=>{cursor=0;return scope.Component(props);};
 const find=(node,type)=>node?.type===type?node:node?.children?.flat(Infinity).map(n=>find(n,type)).find(Boolean);
 let view=render();assert.equal(find(view,'select').props.value,'auto');
 const cleanup=effects[0]();await new Promise(resolve=>setImmediate(resolve));
 view=render();assert.equal(find(view,'select').props['aria-label'],'嵌套会话模式');
 assert.deepEqual(find(view,'select').children.map(n=>n.props.value),['auto','on','off']);
 await find(view,'select').props.onChange({target:{value:'on'}});
 assert.equal(find(render(),'select').props.value,'on');assert.deepEqual(writes,['on']);
 defer=true;const stale=poll();
 await find(render(),'select').props.onChange({target:{value:'off'}});
 resolvePoll('on');await stale;
 assert.equal(find(render(),'select').props.value,'off','old poll must not overwrite the acknowledged selection');
 reject=true;await find(render(),'select').props.onChange({target:{value:'on'}});
 view=render();assert.equal(find(view,'select').props.value,'off');
 assert.equal(view.children.at(-1).props.role,'alert');cleanup();
 assert(source.includes("live.command('/collaborate '+mode)"));
});
