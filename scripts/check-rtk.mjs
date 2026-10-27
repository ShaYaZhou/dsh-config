import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// No shell interpolation, profile scripts, PATH edits or hook installation.
export function checkRtk({platform=process.platform, run=spawnSync}={}) {
  const executable=platform==='win32'?'rtk.exe':'rtk';
  const options={encoding:'utf8',timeout:10000,windowsHide:true,shell:false};
  const version=run(executable,['--version'],options);
  assert(version.status===0&&/^rtk \d+\./m.test(version.stdout??''),
    'RTK CLI unavailable on PATH. Install rtk-ai/rtk (Windows: winget install --id rtk-ai.rtk --exact; macOS: brew install rtk), then restart the terminal and Harness. No configuration has been changed.');
  const help=run(executable,['proxy','--help'],options);
  assert(help.status===0&&/proxy/i.test(help.stdout??''),'Installed rtk does not expose the required proxy command; verify it is rtk-ai/rtk.');
  if(platform==='win32') {
    const shell=run('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',
      "$ErrorActionPreference='Stop'; Get-Command rtk.exe -CommandType Application -ErrorAction Stop | Out-Null; & rtk.exe --version; exit $LASTEXITCODE"],options);
    assert(shell.status===0&&/^rtk \d+\./m.test(shell.stdout??''),
      'PowerShell 7 cannot run rtk.exe. Check pwsh.exe and rtk.exe with Get-Command in a NEW terminal; fully exit and reopen Harness after installing. Do not disable execution or sandbox protections.');
  }
  return {executable,version:version.stdout.trim(),platform};
}

export function smokeRtk() {
  const result=checkRtk();
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'dsh RTK smoke '));
  const options={cwd,encoding:'utf8',timeout:15000,windowsHide:true,shell:false};
  try {
    const init=spawnSync(process.platform==='win32'?'git.exe':'git',['init','--quiet'],options);
    assert.equal(init.status,0,'Git is unavailable on PATH');
    fs.writeFileSync(path.join(cwd,'rtk-check.txt'),'disposable verification fixture\n');
    const status=process.platform==='win32'
      ? spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','& rtk.exe git status; exit $LASTEXITCODE'],options)
      : spawnSync(result.executable,['git','status'],options);
    assert(status.status===0&&/rtk-check\.txt/.test(status.stdout??''),
      'RTK could not run Git from the temporary directory. Check Git/PATH and executable access; do not relax protections.');
    console.log('RTK_CHECK_PASS '+JSON.stringify({...result,pathWithSpaces:true,gitStatus:true}));
    console.log('Terminal check only. DSH Standard/PTC sandbox acceptance still requires scripts/test-rtk.cjs in an isolated DSH_HOME.');
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {smokeRtk();} catch(error) {console.error(error.message);process.exitCode=1;}
}
