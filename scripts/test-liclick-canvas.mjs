import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {startAdapter} from '../plugins/liclick-adapter/lib/server.js';

const home=process.env.DSH_HOME || path.join(os.homedir(),'.dsh');
const source=fs.readFileSync(path.join(home,'profiles/desktop/node_modules/@ninkch/dsh-infinite-canvas/client.js'),'utf8');
function extract(name, async=false) {
  const start=source.indexOf(`    ${async?'async ':''}function ${name}(`);
  assert(start>=0,'Missing canvas function: '+name);
  const end=source.indexOf('\n    }',start);
  assert(end>start,'Missing canvas function end: '+name);
  return source.slice(start,end+6);
}
const start=source.indexOf('      async sanbao(prompt, frameBlob, s, o) {');
assert(start>=0);
const video=source.slice(start,source.indexOf('\n      },',start)+8).trim().replace('async sanbao(','async function video(');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'liclick-canvas-'));
const calls=[],receipts=[],requests=[];
const text=value=>JSON.stringify({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]});
const adapter=await startAdapter(root,{
  run:async args=>args[0]==='status'?'{"valid":true}':'  generate_image(prompt)\n可用模型：\n- doubao-seedream-fixture：image，支持 aspect_ratio、默认: 1:1；n、默认: 1\n- midjourney-fixture：MJ，支持 n、可选值: 4、默认: 4\n  generate_video(prompt)\n可用模型：\n- doubao-seedance-fixture：video，支持 duration、默认: 5；aspect_ratio、默认: 16:9；resolution、默认: 720p\n- MiniMax-H3：H3，支持 duration、默认: 5；resolution、可选值: 768P/2K、默认: 768P\n- topaz-fixture：视频增强，支持 reference_images、首项必须为视频资产；resolution、默认: 1080p',
  call:async(tool,args)=>{
    calls.push({tool,args});
    if(tool==='upload_asset')return text({asset_id:'asset-'+calls.length});
    if(tool==='generate_image' && args.model==='midjourney-fixture') return text({status:'Finished',result:{images:[1,2,3,4].map(i=>({url:'https://example.com/'+i+'.png'}))}});
    return text({status:'Finished',result:{url:'https://example.com/'+(tool==='generate_image'?'result.png':'result.mp4')}});
  },
});
try {
  const config=await adapter.configuration();
  const context=vm.createContext({console,Blob,crypto:webcrypto,VIDEO_VENDORS:{sanbao:{base:''}},
    SANBAO_DOWNLOAD_RETRY_MS:1,SANBAO_DOWNLOAD_RETRY_STEP_MS:1,
    parseExtraParams:value=>value?JSON.parse(value):null,
    videoRefNote:()=>'',
    blobToDataUrlScaled:async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64'),
    blobToDataUrl:async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64'),
    fetchViaProxy:async(url,options)=>{
      requests.push({url,key:options.headers?.['Idempotency-Key']});
      const raw=options.bodyRaw instanceof Blob?Buffer.from(await options.bodyRaw.arrayBuffer()):undefined;
      const res=await fetch(url,{method:options.method||'POST',headers:{connection:'close',...options.headers},...(raw?{body:raw}:options.body?{body:JSON.stringify(options.body)}:{})});
      return {ok:res.ok,status:res.status,text:await res.text()};
    },
    vendorPoll:async(_label,_interval,query)=>{
      for(let i=0;i<100;i++){
        const result=await query();
        if(result.state==='done')return result.url;
        if(result.state==='fail')throw new Error(result.error);
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      throw new Error('Canvas polling did not settle');
    },
    downloadVideoWithRetry:async url=>url,
  });
  const helpers=['isLiClickCfg','liclickValue','liclickImageSize','vendorBase','buildSanbaoImageBody','buildSanbaoVideoBody','sanbaoTaskIdOf','sanbaoStatusOf','sanbaoVideoUrlOf','sanbaoErrorOf','sanbaoPollState','sanbaoImageResultOf','sanbaoImagePollState'];
  vm.runInContext(helpers.map(name=>extract(name)).join('\n')+'\n'+extract('sanbaoUploadRaw',true)+'\n'+extract('sanbaoImageTask',true)+'\n'+video+'\nthis.image=sanbaoImageTask;this.video=video;',context);
  const blob=new Blob(['fixture'],{type:'image/png'});
  const onTask=(id,url)=>receipts.push({id,url,submitted:requests.some(request=>request.key===id)});
  assert.equal(await context.image('image',[blob],{...config.image,model:config.image.models[0].model},{ratio:'1:1',onTask}),'https://example.com/result.png');
  assert.equal(await context.video('reference',null,{...config.video,model:config.video.models[0].model},{refs:[blob],ratio:'16:9',onTask}),'https://example.com/result.mp4');
  assert.equal(await context.video('first frame',blob,{...config.video,model:config.video.models[0].model},{refs:[],ratio:'16:9',onTask}),'https://example.com/result.mp4');
  const videos=calls.filter(call=>call.tool==='generate_video');
  assert.equal(videos[0].args.request_type,'reference_images');
  assert.equal(videos[0].args.reference_images[0].type,'reference');
  assert.equal(videos[1].args.request_type,'first_frame');
  assert.equal(videos[1].args.reference_images[0].type,'first_frame');
  assert.equal(receipts.filter(receipt=>!receipt.submitted).length,3,'Each request must save its recovery id before submission');
  const mj=config.image.models.find(model=>model.model==='midjourney-fixture');
  const images=await context.image('four images',[],{...config.image,...mj},{ratio:'1:1',onTask});
  assert.equal(images.length,4,'Canvas must return every fixed-batch image');
  const h3=config.video.models.find(model=>model.model==='MiniMax-H3');
  await context.video('H3',null,{...config.video,...h3},{resolution:'720P',onTask});
  assert.equal(calls.find(call=>call.tool==='generate_video' && call.args.model==='MiniMax-H3').args.extra_params.resolution,'768P');
  const enhancement=config.video.models.find(model=>model.model==='topaz-fixture');
  await context.video('enhance',null,{...config.video,...enhancement},{refs:[new Blob(['video'],{type:'video/mp4'})],onTask});
  const enhanced=calls.find(call=>call.tool==='generate_video' && call.args.model==='topaz-fixture');
  assert.equal(enhanced.args.request_type,'video-enhancement');
  assert.equal(enhanced.args.reference_images[0].type,'video');
  console.log('LICLICK_CANVAS_PROTOCOL_PASS: installed image/video runners, uploads, reference roles and recovery ids; zero real generation calls');
} finally {
  await adapter.close();
  await fs.promises.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
