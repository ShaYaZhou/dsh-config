import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomBytes, randomUUID, createHash, timingSafeEqual} from 'node:crypto';
import {gateway, callTool} from './gateway.js';
import {catalog, toolResult, generation} from './protocol.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LIMIT = 15 * 1024 * 1024;
const MIME = {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','audio/wav':'.wav','audio/mpeg':'.mp3','video/mp4':'.mp4'};
function save(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value), {mode:0o600});
  fs.renameSync(temp, file);
}
function response(res, code, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(value));
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT) throw new Error('参考素材超过 15MB 限制。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function startAdapter(root, {run=gateway, call=callTool} = {}) {
  fs.mkdirSync(root, {recursive:true,mode:0o700});
  const lock = path.join(root, 'adapter.lock');
  try { fs.writeFileSync(lock, String(process.pid), {flag:'wx',mode:0o600}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(lock,'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('LiClick 适配层锁文件损坏。');
    try { process.kill(pid, 0); throw new Error('LiClick 适配层已在运行。'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    fs.unlinkSync(lock);
    fs.writeFileSync(lock, String(process.pid), {flag:'wx',mode:0o600});
  }
  try {
  const connectionFile = path.join(root, 'connection.json');
  const connection = fs.existsSync(connectionFile) ? JSON.parse(fs.readFileSync(connectionFile,'utf8')) : {token:randomBytes(32).toString('hex'),port:0};
  if (!/^[a-f0-9]{64}$/.test(connection.token) || !Number.isInteger(connection.port) || connection.port < 0 || connection.port > 65535) {
    fs.unlinkSync(lock); throw new Error('LiClick 适配层连接配置无效。');
  }
  for (const dir of ['jobs','uploads']) fs.mkdirSync(path.join(root,dir),{recursive:true,mode:0o700});
  const controller = new AbortController();
  let closed = false, active = 0, models, catalogAt = 0, discovery;
  const queue = [], polls = new Map(), running = new Set(), requests = new Set();
  const jobFile = id => path.join(root,'jobs',id+'.json');
  const jobs = new Map();
  for (const file of fs.readdirSync(path.join(root,'jobs')).filter(name => name.endsWith('.json'))) {
    const id = file.slice(0,-5); if (!UUID.test(id)) continue;
    const job = JSON.parse(fs.readFileSync(jobFile(id),'utf8'));
    if (['queued','submitting'].includes(job.status)) {
      job.status = 'failed'; job.error = '上次提交结果未知；请在 LiClick 查询任务，适配层不会自动重新提交。';
      save(jobFile(id),job);
    }
    jobs.set(id,job);
  }
  async function discover() {
    if (models && Date.now()-catalogAt < 600000) return models;
    if (!discovery) discovery = (async () => {
      const status = JSON.parse(await run(['status'],{signal:controller.signal}));
      if (status.valid !== true && status.ok !== true) throw new Error('LiClick 登录已失效，请先运行 atlas-skillhub gateway login。');
      models = catalog(await run(['list-tools','--service','liclick'],{signal:controller.signal}));
      catalogAt = Date.now(); return models;
    })().finally(() => { discovery = undefined; });
    return discovery;
  }
  let base;
  async function upload(bytes, mime, kind, workspace) {
    if (!MIME[mime] || !mime.startsWith(kind+'/') || !bytes.length || bytes.length > LIMIT) throw new Error('不支持的参考素材类型或大小。');
    await discover();
    if (closed) throw new Error('LiClick 适配层正在关闭。');
    const id = randomUUID(), file = path.join(root,'uploads',id+MIME[mime]);
    fs.writeFileSync(file,bytes,{mode:0o600});
    try {
      const result = toolResult(await call('upload_asset',{asset_type:kind,...(workspace?{workspace_id:workspace}:{})},file,{signal:controller.signal}));
      if (!result.assetId) throw new Error('LiClick 未返回素材 ID。');
      save(path.join(root,'uploads',id+'.json'),{assetId:result.assetId,kind,workspace});
      return {id,assetId:result.assetId,url:base+'/assets/'+id};
    } finally { fs.unlinkSync(file); }
  }
  async function reference(value, kind, workspace) {
    if (value.startsWith(base+'/assets/')) {
      const id = value.slice((base+'/assets/').length);
      if (!UUID.test(id)) throw new Error('参考素材 ID 无效。');
      const asset = JSON.parse(fs.readFileSync(path.join(root,'uploads',id+'.json'),'utf8'));
      if (asset.kind !== kind || asset.workspace !== workspace) throw new Error('参考素材类型或工作区不匹配。');
      return asset.assetId;
    }
    const match = value.match(/^data:([a-z0-9/+.-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
    if (!match) throw new Error('请通过画布上传本地参考素材，不接受任意远程地址。');
    return (await upload(Buffer.from(match[2],'base64'),match[1],kind,workspace)).assetId;
  }
  function acceptResult(job, result) {
    if (result.taskId) job.remoteId = result.taskId;
    if (result.url) { job.status='succeeded'; job.url=result.url; job.urls=result.urls; }
    else if (job.remoteId) job.status='processing';
    else throw new Error('未取得远端任务 ID 或结果；请在 LiClick 查询，勿重复提交。');
    save(jobFile(job.id),job);
  }
  async function execute(job, normalized) {
    let submissionStarted = false;
    try {
      job.status='submitting'; save(jobFile(job.id),job);
      const {args,images,audios,videos,midjourney} = normalized;
      const refs = [];
      for (let i=0;i<images.length;i++) refs.push({asset_id:await reference(images[i],'image',args.workspace_id),type:job.kind==='image'?'image':args.request_type==='first_last_frame'?(i===0?'first_frame':'last_frame'):args.request_type==='first_frame'?'first_frame':'reference',...(midjourney?{image_type:'GENERAL'}:{})});
      for (const audio of audios) refs.push({asset_id:await reference(audio.url,'audio',args.workspace_id),type:'audio'});
      for (const video of videos) refs.push({asset_id:await reference(video,'video',args.workspace_id),type:'video'});
      if (refs.length) {
        if (job.kind==='image') args.extra_params.reference_images=refs;
        else args.reference_images=refs;
      }
      submissionStarted = true;
      acceptResult(job,toolResult(await call('generate_'+job.kind,args,undefined,{signal:controller.signal})));
    } catch (error) {
      job.status='failed';
      job.error=error.message + (submissionStarted && !error.remoteFailure ? ' 提交结果可能未知，请先在 LiClick 查询；适配层不会自动重新提交。' : '');
      save(jobFile(job.id),job);
    }
  }
  function pump() {
    while (!closed && active < 2 && queue.length) {
      const item=queue.shift(); active++;
      const task = execute(...item).catch(() => {
        item[0].status='failed'; item[0].error='无法保存任务状态，请在 LiClick 查看结果，勿重复提交。';
      }).finally(() => { running.delete(task); active--; pump(); });
      running.add(task);
    }
  }
  async function poll(job) {
    if (job.status !== 'processing' || !job.remoteId || Date.now()-(job.polledAt||0)<5000) return;
    if (!polls.has(job.id)) polls.set(job.id,(async()=>{
      job.polledAt=Date.now();
      try { acceptResult(job,toolResult(await call('get_task_status',{task_id:job.remoteId,task_type:job.kind},undefined,{signal:controller.signal}))); }
      catch (error) {
        if (error.remoteFailure) { job.status='failed'; job.error=error.message; }
        else job.lastQueryError='查询暂时失败，可继续查询同一任务；未重新提交。';
        save(jobFile(job.id),job);
      }
    })().finally(()=>polls.delete(job.id)));
    await polls.get(job.id);
  }
  async function handle(req,res) {
    try {
      if (closed) return response(res,503,{error:'LiClick 适配层正在关闭。'});
      const auth=Buffer.from(req.headers.authorization||''), expected=Buffer.from('Bearer '+connection.token);
      if (req.headers.origin || req.headers.host !== `127.0.0.1:${connection.port}` || auth.length!==expected.length || !timingSafeEqual(auth,expected)) return response(res,401,{error:'需要本机 LiClick 适配层凭据。'});
      const url=new URL(req.url,base);
      if (req.method==='GET' && url.pathname==='/liclick/health') return response(res,200,{ok:true});
      if (req.method==='POST' && url.pathname==='/liclick/openapi/v1/uploads/raw') {
        const kind=url.searchParams.get('kind')||'image';
        if (!['image','audio','video'].includes(kind)) return response(res,400,{error:'不支持的素材类型。'});
        const asset=await upload(await readBody(req),(req.headers['content-type']||'').split(';')[0],kind);
        return response(res,200,{file:{url:asset.url}});
      }
      const match=url.pathname.match(/^\/liclick\/openapi\/v1\/(images|videos)(?:\/([a-f0-9-]+))?$/i);
      if (!match) return response(res,404,{error:'Unknown endpoint'});
      const kind=match[1]==='images'?'image':'video';
      if (req.method==='GET' && UUID.test(match[2]||'')) {
        const job=jobs.get(match[2]);
        if (!job || job.kind!==kind) return response(res,404,{error:'任务不存在。'});
        await poll(job);
        return response(res,200,{data:{id:job.id,status:job.status==='queued'||job.status==='submitting'?'processing':job.status,error:job.error,...(job.url?{image_url:job.url,video_url:job.url,images:job.kind==='image'?(job.urls||[job.url]):undefined}:{})}});
      }
      if (req.method!=='POST' || match[2]) return response(res,405,{error:'Unsupported method'});
      const id=req.headers['idempotency-key'];
      if (typeof id!=='string' || !UUID.test(id)) return response(res,400,{error:'缺少请求幂等标识；请部署画布 LiClick 适配补丁。'});
      const body=JSON.parse((await readBody(req)).toString('utf8'));
      const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const normalized=generation(kind,body,await discover());
      if (closed) return response(res,503,{error:'LiClick 适配层正在关闭，未提交任务。'});
      // Check after asynchronous discovery: two simultaneous submissions must not both dispatch.
      const prior=jobs.get(id), same=prior?.hash===hash && prior?.kind===kind;
      if (prior) return response(res,same?200:409,same?{data:{id,status:prior.status}}:{error:'相同请求 ID 的内容发生变化；未重复提交。'});
      if (queue.length>=32) return response(res,429,{error:'生成队列已满。'});
      const job={id,hash,kind,status:'queued',createdAt:Date.now(),model:body.model};
      save(jobFile(id),job); jobs.set(id,job); queue.push([job,normalized]);
      response(res,200,{data:{id,status:'queued'}}); pump();
    } catch (error) {
      if (!res.headersSent) response(res,400,{error:error instanceof SyntaxError?'请求格式错误。':error.message});
    }
  }
  const server = http.createServer((req,res) => {
    const task=handle(req,res); requests.add(task);
    task.finally(()=>requests.delete(task)).catch(()=>res.destroy());
  });
  try {
    await new Promise((resolve,reject)=>{ server.once('error',reject); server.listen(connection.port,'127.0.0.1',resolve); });
    connection.port=server.address().port; save(connectionFile,connection);
    base=`http://127.0.0.1:${connection.port}/liclick`;
  } catch (error) { server.closeAllConnections(); server.close(); fs.unlinkSync(lock); throw error; }
  return {
    async configuration() {
      const found=await discover();
      if (closed) throw new Error('LiClick 适配层正在关闭。');
      return {
        image:{id:'liclick-local',name:'LiClick · 图片',baseUrl:base,apiKey:connection.token,mode:'sanbao',models:found.image.map(m=>({id:m.id,model:m.id,label:m.id+(m.outputCount>1?`（每批 ${m.outputCount} 张）`:''),parameters:m.parameters,outputCount:m.outputCount,maxImages:m.maxImages}))},
        video:{id:'liclick-local',name:'LiClick · 视频',url:base,apiKey:connection.token,vendor:'sanbao',protocol:'generic',models:found.video.map(m=>({id:m.id,model:m.id,label:m.id+(m.category==='enhancement'?'（视频增强）':''),parameters:m.parameters,category:m.category,requestTypes:m.requestTypes,maxImages:m.maxImages,maxVideos:m.maxVideos,audioReferences:m.audioReferences}))},
      };
    },
    async close() {
      closed=true; controller.abort(); server.closeAllConnections();
      await Promise.allSettled([...requests,...running,...polls.values()]);
      return new Promise(resolve=>server.close(()=>{fs.unlinkSync(lock);resolve();}));
    },
  };
  } catch (error) {
    if (fs.existsSync(lock)) fs.unlinkSync(lock);
    throw error;
  }
}
