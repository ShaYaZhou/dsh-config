import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire,stripTypeScriptTypes} from 'node:module';

const [profile,native]=process.argv.slice(2);
assert(profile&&native,'Pass an installed profile and matching native package directory');
const {chromium}=createRequire(path.resolve(profile,'package.json'))('playwright');
const host=fs.readFileSync(path.join(native,'dsh-client-ui-sidebar/lib/client.js'),'utf8');
const css=host.match(/const css=`([^`]+)`;/)?.[1];
const map=host.match(/SidebarRoot_module_css_default=(\{[^}]+\})/)?.[1];
assert(css&&map,'Native sidebar style markers changed');
const classes=JSON.parse(map.replaceAll('`','"'));
const workspaceHost=fs.readFileSync(path.join(native,'dsh-client-ui-workspace/lib/client.js'),'utf8');
const workspaceMap=workspaceHost.match(/WorkspaceBrowser_module_css_default=(\{[^}]+\})/)?.[1];
assert(workspaceMap,'Native workspace style markers changed');
const workspace=JSON.parse(workspaceMap.replaceAll('`','"'));
const workspaceCss=[...workspaceHost.matchAll(/const css(?:\$\d+)?=`([^`]+)`;/g)].map(match=>match[1]).find(value=>value.includes('.'+workspace.root+'{'));
assert(workspaceCss,'Native workspace CSS missing');
const base=path.join(profile,'node_modules/dsh-better-sidebar');
const adapter=stripTypeScriptTypes(fs.readFileSync(path.join(base,'src/client/native/sidebar-navigation.ts'),'utf8')).replace('export function','function');
const handoffStart=host.indexOf('const GESTURE_GAP_MS='),handoffEnd=host.indexOf('const css=',handoffStart);
assert(handoffStart>=0&&handoffEnd>handoffStart,'Native scroll handoff markers changed');
const output=path.resolve(path.dirname(process.argv[1]),'../.local');
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
try{
 const page=await browser.newPage({viewport:{width:1100,height:800}});
 await page.setContent(`<div class="${classes.root} ${classes.quietBars}" style="height:650px;width:280px"><div class="${classes.scrollRegion}"><div class="${classes.scrollArea}" data-sidebar-scrollport><nav class="${classes.panelList}" aria-label="Global panels">${'<button style="height:38px;flex-shrink:0">Panel</button>'.repeat(25)}</nav><div class="${classes.regionArea}"><div class="${workspace.root}"><div class="${workspace.sectionHeader}">Workspaces</div><div class="${workspace.listArea}" data-sidebar-list-area>${'<p>Session</p>'.repeat(60)}</div></div></div></div></div></div>`);
 await page.addStyleTag({content:css});
 await page.addStyleTag({content:workspaceCss});
 await page.addStyleTag({content:fs.readFileSync(path.join(native,'dsh-client-ui-theme/src/styles/scrollbar.css'),'utf8')});
 await page.addStyleTag({content:fs.readFileSync(path.join(base,'src/client/layout.css'),'utf8')});
 await page.addScriptTag({content:host.slice(handoffStart,handoffEnd)+`;const handoff=createScrollHandoff();handoff.bindViewportRef(document.querySelector('[data-sidebar-scrollport]'));handoff.useSectionScroller().bindScrollerRef(document.querySelector('[data-sidebar-list-area]'));`});
 await page.addScriptTag({content:adapter+'\nwindow.disposeNavigation=registerNavigationResize();'});
 const bar=page.getByRole('separator');await bar.waitFor({state:'visible'});
 const state=()=>page.evaluate(()=>{
  const nav=document.querySelector('nav'),area=document.querySelector('[class$="_regionArea"]'),bar=document.querySelector('[role=separator]');
  const list=document.querySelector('[data-sidebar-list-area]');
  return{navHeight:nav.clientHeight,areaHeight:area.clientHeight,navOverflow:nav.scrollHeight>nav.clientHeight,areaOverflow:area.scrollHeight>area.clientHeight+1,listOverflow:list.scrollHeight>list.clientHeight,barHeight:bar.getBoundingClientRect().height,navScroll:getComputedStyle(nav).overflowY,listScroll:getComputedStyle(list).overflowY};
 });
 const before=await state();assert(before.navOverflow&&before.listOverflow);assert(!before.areaOverflow,'Workspace must have only its native list scrollport, not a second outer scrollbar');assert(before.barHeight>=8);assert.equal(before.navScroll,'auto');assert.equal(before.listScroll,'auto');assert(before.areaHeight>=100);
 await bar.focus();await page.keyboard.press('ArrowDown');
 const after=await state();assert(after.navHeight>before.navHeight);assert(after.areaHeight<before.areaHeight);
 await page.locator('nav').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 assert(await page.locator('nav').evaluate(el=>el.scrollTop>0));
 await page.locator('[data-sidebar-list-area]').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 assert(await page.locator('[data-sidebar-list-area]').evaluate(el=>el.scrollTop>0));
 for(const selector of ['[data-sidebar-list-area]','nav']){
  const region=page.locator(selector);await region.evaluate(el=>{el.scrollTop=0;});
  await region.hover();await page.mouse.wheel(0,180);
  await page.waitForFunction(selector=>document.querySelector(selector).scrollTop>0,selector,{timeout:3000});
  const down=await region.evaluate(el=>el.scrollTop);await page.mouse.wheel(0,-120);
  await page.waitForFunction(({selector,down})=>document.querySelector(selector).scrollTop<down,{selector,down},{timeout:3000});
 }
 assert.equal(await page.locator('[class$="_regionArea"]').evaluate(el=>el.scrollTop),0,'Wheeling the list must not move an outer scrollport');
 const list=page.locator('[data-sidebar-list-area]');await list.evaluate(el=>{el.scrollTop=0;});
 const bounds=await list.boundingBox();assert(bounds);
 const gutter=await list.evaluate(el=>el.offsetWidth-el.clientWidth);assert(gutter>0,'Native scrollbar must have a visible gutter');
 const thumbX=bounds.x+bounds.width-gutter/2;
 await page.screenshot({path:path.join(output,'sidebar-thumb-before.png')});
 await page.mouse.move(thumbX,bounds.y+15);await page.mouse.down();await page.mouse.move(thumbX,bounds.y+bounds.height*.7,{steps:8});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('[data-sidebar-list-area]').scrollTop>0,null,{timeout:3000});
 await page.screenshot({path:path.join(output,'sidebar-thumb-after.png')});
 const propagation=await page.evaluate(()=>{
  const root=document.querySelector('[data-sidebar-scrollport]'),region=document.querySelector('[class$="_regionArea"] > div');let seen=0;
  root.addEventListener('wheel',()=>seen++);
  for(const options of [{ctrlKey:true,deltaY:100},{deltaX:100,deltaY:10}])region.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,...options}));
  const preserved=seen;region.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100}));
  const isolated=seen;window.disposeNavigation();region.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100}));
  return{preserved,isolated,disposed:seen};
 });
 assert.deepEqual(propagation,{preserved:2,isolated:2,disposed:3});
 console.log('SIDEBAR_LAYOUT_PASS native rc.2 CSS and wheel handoff, visible separator, keyboard resizing, both scroll directions in each region');
}finally{await browser.close();}
