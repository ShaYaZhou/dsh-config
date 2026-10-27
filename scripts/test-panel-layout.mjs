import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Optional browser regression uses the already deployed Playwright dependency.
const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const require = createRequire(path.resolve(home, 'profiles/desktop/node_modules/@playwright/mcp/package.json'));
const { chromium } = require('playwright');
const source = name => fs.readFileSync(new URL(`../plugins/${name}/lib/client.js`, import.meta.url), 'utf8');
const local = source('local-environments').match(/style.textContent = `([\s\S]*?)`;/)[1].replaceAll('${prefix}', 'dsh-local-env');
const nested = source('nested-sessions').match(/const css = `([\s\S]*?)`;/)[1];
const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  for (const width of [400, 900]) {
    await page.setContent(`<style>body{margin:0}.pane{width:${width}px}${local}${nested}</style>
      <div class="pane"><div class="dsh-local-env"><div class="dsh-local-env-columns">
        <div>最近文件夹</div><div class="dsh-local-env-editor">编辑环境</div>
      </div></div><div class="dsh-nested"><div class="dsh-nested-heading">
        <h2>任务协作</h2><span>已暂停分工</span>
      </div></div></div>`);
    const columns = await page.locator('.dsh-local-env-columns').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    const direction = await page.locator('.dsh-nested-heading').evaluate(el => getComputedStyle(el).flexDirection);
    assert.equal(columns, width === 400 ? 1 : 2);
    assert.equal(direction, width === 400 ? 'column' : 'row');
    assert(await page.locator('.pane').evaluate(el => el.scrollWidth <= el.clientWidth));
  }
  console.log('PANEL_CONTAINER_LAYOUT_PASS');
} finally {
  await browser.close();
}
