import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

function host() {
  const code = fs.readFileSync(new URL('../plugins/dynamic-ui-view/lib/index.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '');
  const sandbox = {readFileSync:fs.readFileSync,path,defineTool:tool=>tool,
    z:{object:value=>value,string:()=>({})}};
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.normalizeWidget = normalizeWidget;this.apply = apply;', sandbox);
  return sandbox;
}

test('bundled dynamic-ui is on demand and shares the native agent lifecycle',()=>{
  const {apply}=host(),events=new Map(),tools=[],skills=[];let cleanup,removed=0;
  const agent={ctx:{tools:{register:tool=>{tools.push(tool);return ()=>removed++;}},get:name=>{
    assert.equal(name,'skills');return {register:skill=>{skills.push(skill);return ()=>removed++;}};
  }}};
  apply({agents:{list:()=>[agent]},on:(event,fn)=>events.set(event,fn),effect:fn=>{cleanup=fn();}},
    {skillDirectory:fileURLToPath(new URL('../skills/dynamic-ui',import.meta.url))});
  events.get('agent/created')({agent});
  assert.equal(tools.length,1);assert.equal(skills.length,1);
  assert.equal(skills[0].name,'dynamic-ui');assert(!skills[0].content.startsWith('---'));
  assert.match(tools[0].description,/Full websites, applications, dashboards/);
  assert.equal(skills[0].source,'runtime');
  events.get('agent/disposed')({agent});assert.equal(removed,2);cleanup();assert.equal(removed,2);
});

function client() {
  let exported;
  const code = fs.readFileSync(new URL('../plugins/dynamic-ui-view/lib/client.js', import.meta.url), 'utf8')
    .replace(
      'return { inject, apply };',
      'return { inject, apply, documentFor, clampHeight, clampReportedHeight, widgetDefinition, requestMeasure };',
    );
  vm.runInNewContext(code, {
    Event: class { constructor(type) { this.type = type; } },
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

test('a widget keeps its title, height and size metadata', () => {
  const { normalizeWidget } = host();
  assert.deepEqual({ ...normalizeWidget({ html: '<svg/>' }) }, { title: '可视化', height: 420, bytes: 6 });
  assert.deepEqual(
    { ...normalizeWidget({ html: '<p>x</p>', title: '  延迟分布  ', height: 512 }) },
    { title: '延迟分布', height: 512, bytes: 8 },
  );
  assert.equal(normalizeWidget({ html: '<p/>', title: 'x'.repeat(120) }).title.length, 80);
});

test('heights are clamped and absent or non-numeric heights fall back', () => {
  const { normalizeWidget } = host();
  assert.equal(normalizeWidget({ html: '<p/>', height: 10 }).height, 200);
  assert.equal(normalizeWidget({ html: '<p/>', height: 5000 }).height, 900);
  assert.equal(normalizeWidget({ html: '<p/>', height: 320.4 }).height, 320);
  assert.equal(normalizeWidget({ html: '<p/>', height: '600' }).height, 420);
  assert.equal(normalizeWidget({ html: '<p/>', height: Number.NaN }).height, 420);
});

test('fragments are validated before they reach the frame', () => {
  const { normalizeWidget } = host();
  assert.throws(() => normalizeWidget({ html: '   ' }), /非空/);
  assert.throws(() => normalizeWidget({}), /非空/);
  assert.throws(() => normalizeWidget({ html: '<!doctype html><p/>' }), /只传片段/);
  assert.throws(() => normalizeWidget({ html: '<body><p/></body>' }), /只传片段/);
  assert.throws(() => normalizeWidget({ html: 'x'.repeat(200001) }), /上限/);
});

test('the frame document blocks every network request and keeps the fragment isolated', () => {
  const { documentFor } = client();
  const doc = documentFor('<p>hi</p>');
  assert.match(doc, /^<!doctype html>/);
  assert.match(doc, /Content-Security-Policy/);
  assert.match(doc, /default-src 'none'/);
  assert.match(doc, /script-src 'unsafe-inline'/);
  assert.match(doc, /prefers-color-scheme:dark/);
  // 固定滚动条槽，避免内容变高时滚动条挤掉宽度、再触发换行把高度顶高。
  assert.match(doc, /scrollbar-gutter:stable/);
  assert.match(doc, /<p>hi<\/p><script>/);
  assert.match(doc, /dsh-widget-height/);
  // 折叠时量到的高度偏小，父端展开后要能请求重新测量。
  assert.match(doc, /dsh-widget-measure/);
  assert.equal(documentFor(undefined), documentFor(''));
});

test('content-reported heights fit the frame but stay bounded', () => {
  const { clampReportedHeight } = client();
  assert.equal(clampReportedHeight(640), 640);
  assert.equal(clampReportedHeight(640.2), 641);
  assert.equal(clampReportedHeight(40), 200);
  assert.equal(clampReportedHeight(9000), 2400);
  assert.equal(clampReportedHeight('640'), 640);
  assert.equal(clampReportedHeight(undefined), 420);
  assert.equal(clampReportedHeight(Number.NaN), 420);
});

test('height clamping matches the host', () => {
  const { clampHeight } = client();
  assert.equal(clampHeight(undefined), 420);
  assert.equal(clampHeight(50), 200);
  assert.equal(clampHeight(5000), 900);
});

test('ordinary and PTC widgets render as stable native turn rows, outside tool disclosure',()=>{
  const {widgetDefinition:d}=client();
  const location={kind:'step',turn:{turn:1},step:{step:1}};
  const start={event:{type:'tool/call',seq:2,data:{name:'render_widget',callId:'one',arguments:JSON.stringify({html:'<button>one</button>'})}},location};
  const context={key:'widget:one',id:'one',start,matches:[start]};
  context.state=d.start(context,start);
  assert.equal(d.buildViewNode(context),null);
  context.state=d.update(context,{event:{type:'tool/result',seq:3,data:{message:{isError:false}}}});
  const node=d.buildViewNode(context);assert.equal(node.groupTree,'turn');assert.equal(node.key,'widget:one');assert.equal(node.data.html,'<button>one</button>');
  const ptc={event:{type:'tool/ptc-dispatch',seq:4,data:{name:'render_widget',subCallId:'nested',arguments:{html:'<b>PTC</b>'},isError:false}},location};
  assert.equal(d.match(ptc.event).id,'nested');
  context.state=d.start(context,ptc);assert.equal(d.buildViewNode(context).data.html,'<b>PTC</b>');
  context.state=d.start(context,{...ptc,event:{...ptc.event,data:{...ptc.event.data,isError:true}}});assert.equal(d.buildViewNode(context),null);
});

test('a measure request is posted into the frame and a missing frame is ignored', () => {
  const { requestMeasure } = client();
  const sent = [];
  requestMeasure({ contentWindow: { postMessage: (message, target) => sent.push({ message, target }) } });
  // 沙箱里造的对象原型不同，逐字段比较。
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.type, 'dsh-widget-measure');
  assert.equal(sent[0].target, '*');
  assert.equal(requestMeasure(null), undefined);
  assert.equal(requestMeasure({}), undefined);
});

test('the native card renderer is separate from its tool detail', () => {
  const { inject, apply } = client();
  assert.deepEqual([...inject], ['slots','uiConversation']);
  const registered=[];let definition;
  const ctx = {
    effect: run=>run(),
    uiConversation:{events:{register:value=>{definition=value;}}},
    slots: {
      inject: (name, run) => {
        assert(['tool.call.toolview','conversation.chat.node'].includes(name));
        return run();
      },
      register: (entry) => {
        registered.push(entry);
      },
    },
  };
  apply(ctx);
  assert.equal(definition.kind,'dynamic-ui-widget');
  assert.equal(registered[0].name,'conversation.chat.node');
  assert.equal(registered[0].key,'dynamic-ui-widget');
  assert.equal(registered[1].key,'render_widget');
});
