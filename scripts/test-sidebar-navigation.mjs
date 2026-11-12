// Integration check against the patched package, using an external jsdom installation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';

const [profile, dependencies] = process.argv.slice(2);
assert(profile && dependencies, 'Usage: node scripts/test-sidebar-navigation.mjs <profile> <directory containing jsdom>');
const { JSDOM } = createRequire(path.resolve(dependencies, 'package.json'))('jsdom');
const dom = new JSDOM('<main><nav aria-label="Global panels"></nav><div class="native_regionArea"></div></main>', {
  url: 'https://fixture.invalid', runScripts: 'outside-only',
});
const w = dom.window;
let observerCount = 0;
w.ResizeObserver = class {
  constructor() { observerCount++; }
  observe() {}
  disconnect() { observerCount--; }
};
const root = w.document.querySelector('main');
root.classList.add('native_scrollArea');
const nav = root.firstElementChild;
const region = root.lastElementChild;
root.getBoundingClientRect = () => ({ height: 800, width: 280 });
nav.getBoundingClientRect = () => ({ height: Number.parseFloat(nav.style.getPropertyValue('--dsh-navigation-height')) || 280, width: 280 });
region.getBoundingClientRect = () => ({ height: 600 - nav.getBoundingClientRect().height, width: 280 });
const source = fs.readFileSync(path.join(profile, 'node_modules/dsh-better-sidebar/src/client/native/sidebar-navigation.ts'), 'utf8');
w.eval(stripTypeScriptTypes(source).replace('export function', 'function') + '\nwindow.installDivider = registerNavigationResize;');
const dispose = w.installDivider();
assert(root.classList.contains('dsh-navigation-split'),'rc.2 grid scrollport must use the scoped split layout');
root.setAttribute('data-sidebar-scrollport', ''); // Native host adds this only after expanding the sidebar.
const bar = root.querySelector('[role="separator"]');
assert(bar && nav.nextElementSibling === bar && bar.nextElementSibling === region);
const key = name => bar.dispatchEvent(new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
key('End');
assert.equal(nav.getBoundingClientRect().height, 480, 'workspace retains 120px');
key('Home');
assert.equal(nav.getBoundingClientRect().height, 72, 'navigation stays reachable');
key('ArrowDown');
assert.equal(nav.getBoundingClientRect().height, 96);
const persisted = w.localStorage.getItem('dsh-better-sidebar.navigation-height.v1');
bar.setPointerCapture = () => {};
bar.hasPointerCapture = () => true;
bar.releasePointerCapture = () => {};
const pointer = (type, y) => bar.dispatchEvent(new w.MouseEvent(type, { clientY: y, button: 0, bubbles: true, cancelable: true }));
pointer('pointerdown', 100); pointer('pointermove', 200); key('Escape');
assert.equal(nav.getBoundingClientRect().height, 96, 'Escape restores the pre-drag height');
assert.equal(w.localStorage.getItem('dsh-better-sidebar.navigation-height.v1'), persisted);
pointer('pointerdown', 100); pointer('pointermove', 160); pointer('pointerup', 160);
assert.equal(nav.getBoundingClientRect().height, 156);
dispose();
assert(!root.classList.contains('dsh-navigation-split'),'Disposal must restore the native layout');
assert(!root.querySelector('[role="separator"]'));
assert.equal(observerCount, 0);
assert.equal(nav.style.getPropertyValue('--dsh-navigation-height'), '');
const disposeAgain = w.installDivider();
assert.equal(nav.getBoundingClientRect().height, 156, 'saved size survives remount');
root.querySelector('[role="separator"]').dispatchEvent(new w.MouseEvent('dblclick'));
assert.equal(w.localStorage.getItem('dsh-better-sidebar.navigation-height.v1'), null);
disposeAgain();
dom.window.close();
console.log('PASS: drag, keyboard limits, cancel, persistence, reset and disposal');
