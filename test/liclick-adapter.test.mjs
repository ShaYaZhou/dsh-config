import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startAdapter} from '../plugins/liclick-adapter/lib/server.js';
import {catalog, generation, toolResult} from '../plugins/liclick-adapter/lib/protocol.js';
import {gateway} from '../plugins/liclick-adapter/lib/gateway.js';

const listing = `Found 3 tool(s):
  generate_image(prompt, model)
可用模型：
- doubao-seedream-fixture：图片模型，支持 aspect_ratio、可选值: 1:1/16:9、默认: 1:1；n、范围: 1~4、默认: 1
- midjourney-fixture：图片模型，支持 n、可选值: 4、默认: 4
  generate_video(prompt, model)
可用模型：
- doubao-seedance-fixture：视频模型，支持 duration、范围: 4~30、默认: 5；aspect_ratio、可选值: adaptive/16:9、默认: 16:9；count、可选值: 1/2/4、默认: 1；resolution、可选值: 720p/1080p、默认: 720p
  get_task_status(task_id)
`;
const content = value => JSON.stringify({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]});
const models = catalog(listing);
const imageBody = {model:models.image[0].id,prompt:'测试 $(never-run) & echo 私密',aspect_ratio:'1:1'};

test('catalog and tool results preserve live identifiers and distinguish pending, finished and failed',()=>{
  assert.equal(models.image[0].id,'doubao-seedream-fixture');
  assert.throws(()=>catalog('Found 0 tool(s)'));
  assert.equal(toolResult(content({task_id:'remote-1',status:'Processing'})).taskId,'remote-1');
  assert.equal(toolResult(content('图片生成完成\nhttps://example.com/image.png。')).url,'https://example.com/image.png');
  assert.equal(toolResult(content({status:'Finished',result:{videos:[{url:'https://example.com/a.mp4'}]}})).url,'https://example.com/a.mp4');
  assert.equal(toolResult(content({asset_id:'asset-1'})).assetId,'asset-1');
  assert.throws(()=>toolResult(content({status:'Failed',err_msg:'rejected'})),error=>error.remoteFailure===true);
  assert.throws(()=>toolResult(JSON.stringify({isError:true,content:[]})));
  assert.equal(toolResult(content('处理中，帮助见 https://example.com/help')).url,undefined);
});

const fullCatalog=catalog(fs.readFileSync(new URL('./fixtures/liclick-catalog.txt',import.meta.url),'utf8'));
test('all advertised image/video models are discovered without treating examples or request types as models',()=>{
  assert.equal(fullCatalog.image.length,11);
  assert.equal(fullCatalog.video.length,14);
  for(const id of ['gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','nano_banana_2','nano_banana_2_1','nano_banana_pro'])
    assert(fullCatalog.image.some(m=>m.id===id),id);
  for(const id of ['MiniMax-H3','kling-v3-omni','gemini-omni-flash-preview','viduq4-preview','topaz-iris-2'])
    assert(fullCatalog.video.some(m=>m.id===id),id);
  assert(!fullCatalog.image.some(m=>m.id==='OpenAI'));
  assert(!fullCatalog.video.some(m=>m.id==='text_prompt'));
});

test('GPT and Banana image parameters retain requested sizes and multi-image MJ output',()=>{
  for(const id of ['gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','nano_banana_2','nano_banana_2_1']) {
    const value=generation('image',{model:id,prompt:'test',aspect_ratio:'16:9',image_size:'2K'},fullCatalog);
    assert.equal(value.args.extra_params.image_size,'2K');
    assert.equal(value.args.extra_params.aspect_ratio,'16:9');
  }
  assert.equal(generation('image',{model:'gpt-image-2.5-sunburst',prompt:'test',aspect_ratio:'auto'},fullCatalog).args.extra_params.image_size,'auto');
  assert.equal(generation('image',{model:'gpt-image-2',prompt:'test',extra_params:{aspect_ratio_w:4,aspect_ratio_h:3}},fullCatalog).args.extra_params.image_size,'1K');
  assert.equal(generation('image',{model:'midjourney-8.2',prompt:'test'},fullCatalog).args.extra_params.n,4);
  assert.equal(toolResult(content({status:'Finished',result:{images:[{url:'https://example.com/1.png'},{url:'https://example.com/2.png'}]}})).urls.length,2);
});

test('video capabilities enforce H3, Kling, Vidu and source-video enhancement contracts',()=>{
  const h3=generation('video',{model:'MiniMax-H3',prompt:'test',request_type:'first_frame',images:['data:image/png;base64,YQ=='],resolution:'768p',duration:6},fullCatalog).args;
  assert.equal(h3.extra_params.resolution,'768P');
  assert.notEqual(h3.extra_params.aspect_ratio,'adaptive');
  assert.throws(()=>generation('video',{model:'MiniMax-H3',prompt:'test',resolution:'720p'},fullCatalog),/可选值/);
  assert.equal(generation('video',{model:'kling-v2-5-turbo',prompt:'test'},fullCatalog).args.extra_params.resolution,'1080p');
  assert.equal(generation('video',{model:'viduq3-pro',prompt:'test'},fullCatalog).args.extra_params.duration,4);
  assert.throws(()=>generation('video',{model:'viduq3-pro',prompt:'test',duration:5},fullCatalog),/可选值/);
  const enhancement=generation('video',{model:'topaz-iris-2',prompt:'',videos:['data:video/mp4;base64,YQ==']},fullCatalog);
  assert.equal(enhancement.args.request_type,'video-enhancement');
  assert(!Object.hasOwn(enhancement.args.extra_params,'duration'));
  assert.throws(()=>generation('video',{model:'topaz-iris-2',prompt:'test',images:['data:image/png;base64,YQ==']},fullCatalog),/原视频/);
  assert.throws(()=>generation('video',{model:'gemini-omni-flash-preview',prompt:'test',images:Array(15).fill('data:image/png;base64,YQ=='),videos:['data:video/mp4;base64,YQ==']},fullCatalog),/总素材/);
});

test('every advertised model accepts its declared defaults and required reference category',()=>{
  for(const model of fullCatalog.image) {
    const result=generation('image',{model:model.id,prompt:'catalog default check'},fullCatalog);
    assert.equal(result.args.model,model.id);
  }
  for(const model of fullCatalog.video) {
    const media=model.category==='enhancement'?{videos:['data:video/mp4;base64,YQ==']}:!model.requestTypes.includes('text_prompt')?{images:['data:image/png;base64,YQ==']}:{};
    const result=generation('video',{model:model.id,prompt:'catalog default check',...media},fullCatalog);
    assert.equal(result.args.model,model.id);
    assert(model.requestTypes.includes(result.args.request_type));
  }
  assert.throws(()=>generation('image',{model:'gpt-image-2',prompt:'test',extra_params:JSON.parse('{"__proto__":{"polluted":true}}')},fullCatalog));
  assert.equal({}.polluted,undefined);
});

test('generation validates model, quantity, reference modes and explicit audio parameters',()=>{
  assert.equal(generation('image',imageBody,models).args.prompt,imageBody.prompt);
  for (const change of [{model:'unknown'},{n:4},{extra_params:{model:'another'}},{workspace_id:'shared'}])
    assert.throws(()=>generation('image',{...imageBody,...change},models));
  const video={model:models.video[0].id,prompt:'video',images:['data:image/png;base64,YQ==']};
  assert.equal(generation('video',video,models).args.request_type,'first_frame');
  assert.equal(generation('video',video,models).args.extra_params.aspect_ratio,'adaptive');
  assert.throws(()=>generation('video',{...video,request_type:'first_last_frame'},models));
  assert.throws(()=>generation('video',{...video,generateAudio:'false'},models));
});

async function fixture(t, call) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-liclick-'));
  const run=async args=>{await new Promise(resolve=>setTimeout(resolve,10));return args[0]==='status'?'{"valid":true}':listing;};
  let adapter=await startAdapter(root,{run,call});
  const config=await adapter.configuration();
  t.after(async()=>{await adapter.close();await fs.promises.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
  async function request(method, endpoint, body, key, extraHeaders={}) {
    const res=await fetch(config.image.baseUrl+endpoint,{method,headers:{connection:'close',authorization:'Bearer '+config.image.apiKey,...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{}),...extraHeaders},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,body:await res.json()};
  }
  return {root,config,request,restart:async()=>{await adapter.close();adapter=await startAdapter(root,{run,call});}};
}
async function until(predicate) {
  for(let i=0;i<100;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}
  throw new Error('Fixture did not settle');
}

test('authenticated async submission deduplicates concurrent retries and rejects nonce conflicts',async t=>{
  const calls=[];
  const f=await fixture(t,async(tool,args)=>{
    calls.push({tool,args});
    return tool==='get_task_status'?content('图片生成完成\nhttps://example.com/done.png'):content({task_id:'remote-1',status:'Processing'});
  });
  assert.equal((await f.request('POST','/openapi/v1/images',imageBody,randomUUID(),{authorization:''})).status,401);
  assert.equal((await f.request('POST','/openapi/v1/images',imageBody,randomUUID(),{origin:'https://untrusted.example'})).status,401);
  assert.equal((await f.request('POST','/openapi/v1/images',imageBody)).status,400);
  assert.equal(calls.length,0);
  const id=randomUUID();
  const results=await Promise.all([f.request('POST','/openapi/v1/images',imageBody,id),f.request('POST','/openapi/v1/images',imageBody,id)]);
  assert(results.every(r=>r.status===200 && r.body.data.id===id));
  await until(()=>calls.length===1);
  assert.equal(calls[0].args.prompt,imageBody.prompt);
  assert.equal((await f.request('POST','/openapi/v1/images',{...imageBody,prompt:'different'},id)).status,409);
  const result=await f.request('GET','/openapi/v1/images/'+id);
  assert.equal(result.body.data.status,'succeeded');
  assert.equal(result.body.data.image_url,'https://example.com/done.png');
  await f.request('POST','/openapi/v1/images',imageBody,id);
  assert.equal(calls.filter(c=>c.tool==='generate_image').length,1);
});

test('reference images are uploaded before generation and remote task polling survives restart',async t=>{
  const calls=[];
  const f=await fixture(t,async(tool,args,file)=>{
    calls.push({tool,args});
    if(tool==='upload_asset'){assert(fs.existsSync(file));return content({asset_id:'uploaded-1'});}
    if(tool==='get_task_status')return content({status:'Finished',result:{videos:[{url:'https://example.com/clip.mp4'}]}});
    return content({task_id:'video-1',status:'Processing'});
  });
  const id=randomUUID(),body={model:models.video[0].id,prompt:'video',images:['data:image/png;base64,YQ==']};
  assert.equal((await f.request('POST','/openapi/v1/videos',body,id)).status,200);
  await until(()=>calls.some(c=>c.tool==='generate_video'));
  const submitted=calls.find(c=>c.tool==='generate_video').args;
  assert.deepEqual(submitted.reference_images,[{asset_id:'uploaded-1',type:'first_frame'}]);
  await until(()=>JSON.parse(fs.readFileSync(path.join(f.root,'jobs',id+'.json'))).status==='processing');
  await f.restart();
  assert.equal((await f.request('GET','/openapi/v1/videos/'+id)).body.data.video_url,'https://example.com/clip.mp4');
  assert.equal(calls.filter(c=>c.tool==='generate_video').length,1);
  assert(!fs.readdirSync(path.join(f.root,'uploads')).some(file=>file.endsWith('.png')));
});

test('all fixed-batch image URLs survive restart and querying does not regenerate',async t=>{
  let submissions=0;
  const urls=[1,2,3,4].map(i=>'https://example.com/'+i+'.png');
  const f=await fixture(t,async()=>{submissions++;return content({status:'Finished',result:{images:urls.map(url=>({url}))}});});
  const id=randomUUID(),body={model:'midjourney-fixture',prompt:'four pictures'};
  await f.request('POST','/openapi/v1/images',body,id);
  await until(()=>JSON.parse(fs.readFileSync(path.join(f.root,'jobs',id+'.json'))).status==='succeeded');
  await f.restart();
  await f.request('POST','/openapi/v1/images',body,id);
  assert.deepEqual((await f.request('GET','/openapi/v1/images/'+id)).body.data.images,urls);
  assert.equal(submissions,1);
});

test('unknown submission is never replayed after restart; unsupported references cannot reach generation',async t=>{
  let generated=0;
  const f=await fixture(t,async tool=>{if(tool.startsWith('generate'))generated++;return content({});});
  const id=randomUUID();
  fs.writeFileSync(path.join(f.root,'jobs',id+'.json'),JSON.stringify({id,kind:'image',hash:'x',status:'submitting'}));
  await f.restart();
  assert.equal((await f.request('GET','/openapi/v1/images/'+id)).body.data.status,'failed');
  const second=randomUUID();
  await f.request('POST','/openapi/v1/images',{...imageBody,images:['http://127.0.0.1/private']},second);
  await until(()=>JSON.parse(fs.readFileSync(path.join(f.root,'jobs',second+'.json'))).status==='failed');
  assert.equal(generated,0);
});

test('gateway passes prompt as one argument without shell interpretation and hides diagnostic secrets',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'liclick-cli-'));
  const file=path.join(root,'fake.mjs'),previous=process.env.ATLAS_SKILLHUB_CLI;
  process.env.ATLAS_SKILLHUB_CLI=file;
  t.after(async()=>{if(previous===undefined)delete process.env.ATLAS_SKILLHUB_CLI;else process.env.ATLAS_SKILLHUB_CLI=previous;await fs.promises.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
  fs.writeFileSync(file,'console.log(JSON.stringify(process.argv.slice(2)));');
  const args=['call-tool','--args',JSON.stringify(imageBody)];
  assert.deepEqual(JSON.parse(await gateway(args)),['gateway',...args]);
  fs.writeFileSync(file,'console.error("credential-secret");process.exit(1);');
  await assert.rejects(gateway(['status']),error=>!error.message.includes('credential-secret'));
});

test('a submission timeout remains unknown and repeated requests never submit it again',async t=>{
  let submitted=0;
  const f=await fixture(t,async()=>{submitted++;throw new Error('network timeout');});
  const id=randomUUID();
  await f.request('POST','/openapi/v1/images',imageBody,id);
  await until(()=>JSON.parse(fs.readFileSync(path.join(f.root,'jobs',id+'.json'))).status==='failed');
  const result=await f.request('GET','/openapi/v1/images/'+id);
  assert.match(result.body.data.error,/结果可能未知/);
  await f.restart();
  await f.request('POST','/openapi/v1/images',imageBody,id);
  assert.equal(submitted,1);
});

test('shutdown waits for an in-flight request and prevents late generation admission',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-liclick-close-'));
  let release,submitted=0;
  const adapter=await startAdapter(root,{run:async args=>args[0]==='status'?new Promise(resolve=>{release=()=>resolve('{"valid":true}');}):listing,call:async()=>{submitted++;return content({});}});
  try {
    const connection=JSON.parse(fs.readFileSync(path.join(root,'connection.json')));
    const request=fetch(`http://127.0.0.1:${connection.port}/liclick/openapi/v1/images`,{method:'POST',headers:{authorization:'Bearer '+connection.token,'idempotency-key':randomUUID(),'content-type':'application/json'},body:JSON.stringify(imageBody)}).catch(()=>null);
    await until(()=>release);
    const closing=adapter.close();
    release();
    await closing; await request;
    assert.equal(submitted,0);
    assert.equal(fs.readdirSync(path.join(root,'jobs')).length,0);
  } finally {await fs.promises.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
