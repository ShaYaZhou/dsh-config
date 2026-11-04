import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

function executable() {
  const candidates = [process.env.ATLAS_SKILLHUB_CLI];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    candidates.push(path.join(dir, 'node_modules/@lilith/atlas-skillhub/dist/index.js'));
    candidates.push(path.resolve(dir, '../lib/node_modules/@lilith/atlas-skillhub/dist/index.js'));
    try {
      const real = fs.realpathSync(path.join(dir, 'atlas-skillhub'));
      if (real.endsWith('.js')) candidates.push(real);
    } catch { /* Try the next PATH directory. */ }
  }
  const found = candidates.find(file => file && fs.existsSync(file));
  if (!found) throw new Error('找不到 atlas-skillhub CLI；请先安装并登录 LiClick skill 使用的网关。');
  return found;
}

function nodeExecutable() {
  // Commander detects Electron even with ELECTRON_RUN_AS_NODE and changes argv parsing.
  if (!process.versions.electron) return process.execPath;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const file=path.join(dir,process.platform==='win32'?'node.exe':'node');
    try {
      const resolved=fs.realpathSync(file);
      if (resolved===fs.realpathSync(process.execPath) || !fs.statSync(resolved).isFile()) continue;
      const fd=fs.openSync(resolved,'r'),header=Buffer.alloc(2);
      try {fs.readSync(fd,header,0,2,0);} finally {fs.closeSync(fd);}
      if (header.toString()==='#!') continue;
      return resolved;
    } catch { /* Continue past missing PATH entries and launcher scripts. */ }
  }
  throw new Error('LiClick 适配层需要 PATH 中的独立 Node.js；不能使用 Electron 的 Node 启动包装。');
}

export function gateway(args, {signal} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeExecutable(), [executable(), 'gateway', ...args], {
      shell:false, windowsHide:true, stdio:['ignore','pipe','pipe'],
      env:{...process.env, ELECTRON_RUN_AS_NODE:'1'}, signal,
    });
    let stdout = '', bytes = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill(); finish(new Error('LiClick 调用超时，提交结果可能未知；不会自动重新提交。'));
    }, 270000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      bytes += Buffer.byteLength(data);
      if (bytes > 2 * 1024 * 1024) { child.kill(); finish(new Error('网关响应超过大小限制。')); }
      else stdout += data;
    });
    // Gateway diagnostics may contain authentication details; never echo them into the canvas.
    child.stderr.resume();
    child.on('error', () => finish(new Error('无法执行 LiClick 网关，请检查 CLI 和登录状态。')));
    child.on('close', code => finish(code === 0 ? null : new Error('LiClick 网关调用失败；请运行 atlas-skillhub gateway status 检查登录和权限。'), stdout));
  });
}

export function callTool(tool, args, file, options) {
  if (!['generate_image','generate_video','get_task_status','upload_asset'].includes(tool)) throw new Error('Unsupported LiClick tool');
  return gateway(['call-tool','--service','liclick','--tool',tool,'--timeout','240','--args',JSON.stringify(args),
    ...(file ? ['--file',`file_path=${file}`] : [])], options);
}
