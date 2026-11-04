import path from 'node:path';
import os from 'node:os';
import {Service} from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import {startAdapter} from './server.js';

export const name = 'liclick-adapter';
export const Config = z.object({stateDirectory:z.string().default('')});
export async function apply(ctx, config) {
  const root = config.stateDirectory || path.join(process.env.DSH_HOME || path.join(os.homedir(),'.dsh'),'liclick-adapter');
  const adapter = await startAdapter(root);
  class LiClickAdapter extends Service {
    constructor() { super(ctx,'liclickAdapter'); }
    configuration() { return adapter.configuration(); }
  }
  new LiClickAdapter();
  ctx.effect(() => () => adapter.close());
}
