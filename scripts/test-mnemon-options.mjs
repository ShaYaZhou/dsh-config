import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise the installed upstream UI, including its actual Apply callback.
const profile=path.resolve(process.argv[2]);
const text=fs.readFileSync(path.join(profile,'node_modules/dsh-mnemon/lib/client.js'),'utf8');
const start=text.indexOf('\t\tconst LIST_ITEMS =');
const end=text.indexOf('\t\t//#endregion',start);
assert(start>=0&&end>start);
let state, saved=[], confirmations=0, accept=false;
const scope={
  react:{useId:()=> 'fixture',useState:init=>{state??=init();return [state,value=>{state=typeof value==='function'?value(state):value;}];}},
  react_jsx_runtime:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  MnemonSettingsCard_module_css_default:{},
  _deepseek_ai_dsh_client_ui_primitives:{Checkbox:'Checkbox'}, PanelActions:'PanelActions',
  componentCopy:entry=>({label:entry.typeId}),
  window:{confirm:()=>{confirmations++;return accept;}},
};
vm.runInNewContext(text.slice(start,end)+'\nthis.Options=ComponentOptions;this.Choice=SourceChoice;',scope);
const sources=['runtime','documents','memory-spaces','skills'].map((id,i)=>({sourceInstanceKey:'source:'+id,sourceTypeId:id,role:['working-context','narrative','durable-evidence','capability'][i],label:id}));
const entry={typeId:'scoped',config:{},fields:['sourceKeys','writableSourceKeys'].map(key=>({key,input:'source-list',label:{en:key,'zh-CN':key}}))};
const props={entry,language:'zh-CN',dashboard:{sources,entries:[]},name:'Scope',t:key=>key,onApply:config=>saved.push(JSON.parse(JSON.stringify(config)))};
const find=(node,predicate)=>{
  if(!node||typeof node!=='object')return;
  if(predicate(node))return node;
  for(const child of [node.props?.children].flat(Infinity)){const hit=find(child,predicate);if(hit)return hit;}
};
const render=()=>scope.Options(props);
const choice=tree=>find(tree,n=>n.type===scope.Choice&&n.props.field.key==='sourceKeys');
const apply=tree=>find(tree,n=>n.type==='PanelActions').props.onApply();
let tree=render();
const defaults=scope.Choice(choice(tree).props);
const boxes=defaults.props.children.flat(Infinity);
assert.equal(boxes.length,3);assert(boxes.every(box=>box.props.checked));
apply(tree);assert.deepEqual(saved.pop(),{},'Unchanged defaults must not serialize as []');
boxes[0].props.onChange(false);tree=render();apply(tree);
assert.equal(saved.at(-1).sourceKeys.length,2,'First edit starts from effective defaults');
choice(tree).props.onChange([]);tree=render();
const before=saved.length;apply(tree);assert.equal(saved.length,before);assert.equal(confirmations,1);
accept=true;apply(tree);assert.deepEqual(saved.at(-1),{sourceKeys:[]},'An explicitly confirmed empty scope is not widened');
find(tree,n=>n.type==='button'&&n.props.children==='options.reset').props.onClick();
tree=render();apply(tree);assert.deepEqual(saved.at(-1),{},'Reset omits the override');
state=undefined;entry.config={writableSourceKeys:[]};tree=render();apply(tree);
assert.deepEqual(saved.at(-1),{writableSourceKeys:[]},'Existing read-only restrictions survive');
console.log('MNEMON_OPTIONS_PASS defaults, edits, cancelled/confirmed empty save, reset, read-only preservation');
