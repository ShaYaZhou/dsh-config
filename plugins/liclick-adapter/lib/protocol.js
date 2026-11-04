export function catalog(text) {
  const result = {image:[],video:[]};
  let kind, collecting = false;
  for (const line of text.split(/\r?\n/)) {
    const tool = line.match(/^  (\w+)\(/);
    if (tool) {
      kind = tool[1] === 'generate_image' ? 'image' : tool[1] === 'generate_video' ? 'video' : undefined;
      collecting = false;
    }
    if (/^可用模型/.test(line.trim())) collecting = true;
    if (/^(?:示例|调用示例|也可)/.test(line.trim())) collecting = false;
    const model = line.match(/^- ([a-zA-Z0-9_.-]+)[：:]\s*(.+)/);
    if (!kind || !collecting || !model) continue;
    if (!result[kind].some(row => row.id === model[1])) result[kind].push(modelContract(kind,model[1],model[2]));
  }
  if (!result.image.length || !result.video.length) throw new Error('LiClick 模型目录格式不受支持，未找到图片或视频模型；未提交任务。');
  return result;
}

const NUMERIC = new Set(['n','count','duration','target_fps','seed','details','sharpen','denoise','compression_recovery','recover_original_detail','aspect_ratio_w','aspect_ratio_h']);
function scalar(key, value) {
  if (/^(true|false)$/i.test(value)) return value.toLowerCase()==='true';
  return NUMERIC.has(key) && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
}
function modelContract(kind,id,description) {
  const parameters = Object.create(null);
  for (const match of description.matchAll(/(?:支持\s*|；)([a-zA-Z_][\w]*)、([^；]*)/g)) {
    const [,key,detail] = match, field = {detail};
    if (['__proto__','constructor','prototype'].includes(key)) throw new Error('模型目录包含非法参数名。');
    const choices=detail.match(/可选值:\s*([^、；，]+)/)?.[1];
    if (choices) field.options=choices.trim().split('/').map(value=>scalar(key,value.trim()));
    const value=detail.match(/默认:\s*([^、；，]+)/)?.[1];
    if (value) field.default=scalar(key,value.trim());
    const range=detail.match(/范围:\s*(-?\d+)\s*[~～–]\s*(-?\d+)/);
    if (range) {field.min=Number(range[1]);field.max=Number(range[2]);}
    const special=detail.match(/特殊值:\s*(-?\d+)/);
    if (special) field.special=[Number(special[1])];
    const scope=detail.match(/（仅\s+([a-z_/]+)）/);
    if (scope) field.requestTypes=scope[1].split('/');
    parameters[key]=field;
  }
  const category=kind==='video' && /首项必须为视频资产/.test(description)?'enhancement':'generation';
  let requestTypes=[];
  if (kind==='video') {
    requestTypes=category==='enhancement'?['video-enhancement']:['text_prompt','first_frame'];
    // The tool's capability matrix names backend families; preserve its model-specific exceptions.
    if (category!=='enhancement') {
      if (/kling|minimax|hailuo|seedance/i.test(id)) requestTypes.push('first_last_frame');
      if (/kling|minimax|hailuo|seedance|gemini|vidu/i.test(id) || /参考.*生视频/.test(description)) requestTypes.push('reference_images');
      if (/viduq4/i.test(id)) requestTypes=requestTypes.filter(type=>type!=='text_prompt');
    }
  }
  const referenceText=parameters.reference_images?.detail || description;
  const maxReferences=Number(description.match(/总素材最多\s*(\d+)\s*条/)?.[1] || 0);
  const maxImages=Math.min(Number(referenceText.match(/最多\s*(\d+)\s*张/)?.[1] || description.match(/最多\s*(\d+)\s*张/)?.[1] || description.match(/\d+\s*[～~]\s*(\d+)\s*张/)?.[1] || 30),maxReferences || Infinity);
  const videoReferences=category==='enhancement' || /seedance|minimax|hailuo|gemini|kling/i.test(id);
  const maxVideos=category==='enhancement'?1:videoReferences?Number(description.match(/(?:视频最多|参考视频至多)\s*(\d+)/)?.[1] || 3):0;
  const audioReferences=kind==='video' && category!=='enhancement' && /seedance|minimax|hailuo|vidu/i.test(id);
  const outputCount=kind==='image' && parameters.n?.options?.length===1?Number(parameters.n.options[0]):1;
  return {id,description,parameters,category,requestTypes,maxImages,maxVideos,maxReferences,audioReferences,outputCount};
}

export function toolResult(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('LiClick CLI 未返回可解析的工具结果。'); }
  if (value.error || value.isError) throw new Error('LiClick 返回工具错误，请检查网关权限与参数。');
  const texts = Array.isArray(value.content) ? value.content.filter(block => block.type === 'text').map(block => block.text || '') : [];
  const text = texts.join('\n');
  let data = value.structuredContent || value;
  for (const block of texts) {
    try { const parsed = JSON.parse(block); if (parsed && typeof parsed === 'object') data = parsed; } catch { /* Completed results may be prose. */ }
  }
  const status = String(data.status || '').toLowerCase();
  if (['failed','error','cancelled','canceled'].includes(status) || data.isError || data.error) {
    const error = new Error('LiClick 任务失败：' + String(data.err_msg || '请在 LiClick 查看原因。').replace(/https?:\/\/\S+/g,'[链接]').slice(0,200));
    error.remoteFailure = true;
    throw error;
  }
  const taskId = data.task_id || data.request_id || text.match(/(?:task_id|request_id|任务\s*ID)["'\s]*[:：=]\s*["']?([\w-]+)/i)?.[1];
  const assetId = data.asset_id || data.data?.asset_id || text.match(/asset_id["'\s]*[:：=]\s*["']?([\w-]+)/i)?.[1];
  const urls = [];
  function collect(node) {
    if (typeof node === 'string' && /^https:\/\//.test(node)) urls.push(node);
    else if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') for (const [key,val] of Object.entries(node)) {
      if (['url','image_url','video_url','download_url','images','videos','image_urls','video_urls','result','results','assets','data','output'].includes(key)) collect(val);
    }
  }
  collect(data);
  const completed = ['finished','completed','succeeded'].includes(status) || /(?:图片|视频)生成完成/.test(text);
  if (completed) for (const match of text.matchAll(/https:\/\/[^\s<>"'`\]\)，。；]+/g)) urls.push(match[0]);
  const outputs=completed?[...new Set(urls)]:[];
  return {taskId:taskId && String(taskId),assetId:assetId && String(assetId),url:outputs[0],urls:outputs};
}

export function generation(kind, body, models) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求必须为 JSON 对象。');
  const model=models[kind].find(model=>model.id===body.model);
  if (!model) throw new Error('请选择已发现的 LiClick 模型。');
  if (typeof body.prompt !== 'string' || model.category!=='enhancement' && !body.prompt.trim() || body.prompt.length > 12000) throw new Error('请填写不超过 12000 字符的提示词。');
  const images = body.images ?? [], audios = body.audios ?? [], videos=body.videos??[];
  if (!Array.isArray(images) || images.length > model.maxImages || !images.every(x => typeof x === 'string')) throw new Error(`该模型最多接受 ${model.maxImages} 张参考图。`);
  if (!Array.isArray(audios) || audios.length > 3 || !audios.every(x => typeof x?.url === 'string')) throw new Error('最多支持 3 条参考音频。');
  if (!Array.isArray(videos) || videos.length>model.maxVideos || !videos.every(x=>typeof x==='string')) throw new Error(`该模型最多接受 ${model.maxVideos} 段参考视频。`);
  if (model.maxReferences && images.length+audios.length+videos.length>model.maxReferences) throw new Error(`该模型总素材最多 ${model.maxReferences} 条。`);
  if (kind === 'image' && (audios.length || videos.length)) throw new Error('图片生成只接受图片参考。');
  if (audios.length && !model.audioReferences) throw new Error('该模型不接受音频参考。');
  const type=kind==='image'?undefined:body.request_type || (model.category==='enhancement'?'video-enhancement':audios.length || videos.length || images.length>1?'reference_images':images.length?'first_frame':'text_prompt');
  if (kind==='video') {
    if (!model.requestTypes.includes(type)) throw new Error('该模型不支持 '+type+'；支持：'+model.requestTypes.join('、'));
    if (type==='video-enhancement' && (videos.length!==1 || images.length || audios.length)) throw new Error('视频增强需要恰好一个原视频，不接受图片或音频替代。');
    if (type==='text_prompt' && (images.length || audios.length || videos.length) || type==='first_frame' && (images.length!==1 || audios.length || videos.length) || type==='first_last_frame' && (images.length!==2 || audios.length || videos.length) || type==='reference_images' && !images.length && !audios.length && !videos.length) throw new Error('生成方式与参考素材不一致。');
  }
  if (body.extra_params!==undefined && (!body.extra_params || typeof body.extra_params!=='object' || Array.isArray(body.extra_params))) throw new Error('extra_params 必须为对象。');
  const supplied={...(body.extra_params||{})}, extra={};
  const reserved=['model','prompt','workspace_id','request_type','reference_images'];
  const envelope=new Set([...reserved,'images','audios','videos','extra_params','ratio','aspect_ratio','resolution','duration','quality','reference','n','count','generateAudio','generate_audio']);
  for (const key of Object.keys(body)) if (!envelope.has(key) && !Object.hasOwn(model.parameters,key)) throw new Error('当前模型未声明参数：'+key);
  for (const key of Object.keys(supplied)) {
    if (reserved.includes(key)) throw new Error('请通过画布对应字段设置 '+key+'。');
    if (!Object.hasOwn(model.parameters,key)) throw new Error('当前模型未声明参数：'+key);
  }
  for (const [key,rule] of Object.entries(model.parameters)) {
    if (reserved.includes(key) || rule.requestTypes && !rule.requestTypes.includes(type)) continue;
    let value=supplied[key] ?? body[key] ?? rule.default;
    if (key==='aspect_ratio') value=supplied[key] ?? body.aspect_ratio ?? body.ratio ?? rule.default;
    if (key==='aspect_ratio' && type?.startsWith('first') && /seedance/i.test(model.id)) value='adaptive';
    if (key==='n') value=model.outputCount;
    if (key==='count') value=1;
    if (value===undefined) continue;
    if (NUMERIC.has(key) && (typeof value!=='number' || !Number.isFinite(value))) throw new Error(key+' 必须为数字。');
    if (rule.detail.includes('正整数') && (!Number.isInteger(value) || value<=0)) throw new Error(key+' 必须为正整数。');
    if (rule.options) {
      const canonical=rule.options.find(option=>String(option).toLowerCase()===String(value).toLowerCase());
      if (canonical===undefined) throw new Error(key+' 可选值：'+rule.options.join(' / '));
      value=canonical;
    }
    if (!rule.special?.includes(value) && (rule.min!==undefined && value<rule.min || rule.max!==undefined && value>rule.max)) throw new Error(key+` 必须在 ${rule.min}–${rule.max} 范围内。`);
    if (typeof rule.default==='boolean' && typeof value!=='boolean') throw new Error(key+' 必须为布尔值。');
    extra[key]=value;
  }
  if ((supplied.n ?? body.n ?? model.outputCount)!==model.outputCount || (supplied.count ?? body.count ?? 1)!==1) throw new Error(`该模型每次返回 ${model.outputCount} 张图片或一条视频；请使用画布数量控件。`);
  if (Object.hasOwn(extra,'aspect_ratio_w')!==Object.hasOwn(extra,'aspect_ratio_h')) throw new Error('自定义比例必须同时提供 aspect_ratio_w 和 aspect_ratio_h。');
  if (kind==='image' && model.parameters.image_size && model.parameters.image_size.options?.includes('auto')) {
    if (extra.aspect_ratio==='auto' && !Object.hasOwn(extra,'aspect_ratio_w')) {
      if (supplied.image_size && supplied.image_size!=='auto') throw new Error('auto 比例必须搭配 auto 图片尺寸。');
      extra.image_size='auto';
    } else if (extra.image_size==='auto') extra.image_size=model.parameters.image_size.options.find(value=>value!=='auto');
  }
  const audio=body.generateAudio ?? body.generate_audio;
  if (audio!==undefined) {
    if (typeof audio!=='boolean') throw new Error('生成音频开关必须为布尔值。');
    if (model.parameters.generateAudio) extra.generateAudio=audio;
    else if (model.parameters.sound) {
      const value=audio?'on':'off';
      if (!model.parameters.sound.options?.includes(value)) throw new Error('该模型不支持请求的声音模式。');
      extra.sound=value;
    } else if (audio) throw new Error('该模型未提供生成音频开关，请清除供应商的音频覆盖。');
  }
  const args = {model:body.model,prompt:body.prompt,extra_params:extra};
  if (body.workspace_id !== undefined) throw new Error('当前画布适配使用 LiClick 个人工作区。');
  if (kind==='video') args.request_type=type;
  return {args,images,audios,videos,midjourney:/^midjourney-/i.test(model.id)};
}
