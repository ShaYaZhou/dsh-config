import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {gateway} from '../plugins/liclick-adapter/lib/gateway.js';
import {catalog} from '../plugins/liclick-adapter/lib/protocol.js';
import {runner} from './harness.mjs';

if (process.argv.includes('--probe')) {
  try {
    const state=JSON.parse(await gateway(['status']));
    assert(state.valid===true || state.ok===true,'LiClick authentication unavailable');
    const models=catalog(await gateway(['list-tools','--service','liclick']));
    console.log('LICLICK_GATEWAY_PASS '+JSON.stringify({imageModels:models.image.length,videoModels:models.video.length}));
  } catch (error) {console.error(error.message);process.exit(1);}
} else {
  // Exercise the actual Desktop process: system Node alone misses Electron argv incompatibilities.
  const result=spawnSync(runner().executable,[fileURLToPath(import.meta.url),'--probe'],{
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:60000,windowsHide:true,
  });
  assert.equal(result.status,0,'Desktop gateway probe failed: '+(result.stderr||result.error?.message||'unknown error'));
  const marker=result.stdout.split(/\r?\n/).find(line=>line.startsWith('LICLICK_GATEWAY_PASS '));
  assert(marker,'Desktop gateway probe did not finish');
  console.log(marker);
}
