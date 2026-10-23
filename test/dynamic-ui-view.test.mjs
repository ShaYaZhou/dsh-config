import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function host() {
  const code = fs.readFileSync(new URL('../plugins/dynamic-ui-view/lib/index.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.normalizeWidget = normalizeWidget;', sandbox);
  return sandbox;
}

function client() {
  let exported;
  const code = fs.readFileSync(new URL('../plugins/dynamic-ui-view/lib/client.js', import.meta.url), 'utf8')
    .replace(
      'return { inject, apply };',
      'return { inject, apply, documentFor, clampHeight, clampReportedHeight, outerHidden, requestMeasure };',
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

test('the outermost folded ancestor is picked as the portal anchor', () => {
  const { outerHidden } = client();
  const folded = (parent) => ({
    getAttribute: (name) => (name === 'hidden' ? 'until-found' : null),
    parentElement: parent,
  });
  const root = { getAttribute: () => null, parentElement: null };
  const outer = folded(root);
  const inner = folded(outer);
  const seat = { getAttribute: () => null, parentElement: inner };
  const card = { parentElement: seat };
  assert.equal(outerHidden(card), outer);
  assert.equal(outerHidden(root), null);
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

test('the card is keyed by the render_widget wire name', () => {
  const { inject, apply } = client();
  assert.deepEqual([...inject], ['slots']);
  let registered;
  const ctx = {
    slots: {
      inject: (name, run) => {
        assert.equal(name, 'tool.call.toolview');
        return run();
      },
      register: (entry) => {
        registered = entry;
      },
    },
  };
  apply(ctx);
  assert.equal(registered.name, 'tool.call.toolview');
  assert.equal(registered.key, 'render_widget');
});
