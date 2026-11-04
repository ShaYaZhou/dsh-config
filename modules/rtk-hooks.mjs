import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function rtkContext() {
  return {hookSpecificOutput:{hookEventName:'agent/pre-step',additionalContext:
    'Use RTK for supported output-heavy shell commands, including shell calls inside PTC: rtk git status, rtk git diff, rtk rg, rtk npm test. Use rtk proxy when exact unfiltered output is required. Preserve native permissions, cwd, arguments and cancellation. A blocked RTK hook means the original command did not run: resubmit the suggested command once. Never repeat a mutating command just to compress its output. Unsupported commands and complex shell scripts may run normally.'}};
}

export function checkRtkCommand(payload, run=spawnSync) {
  const command=payload?.tool_input?.command;
  if(!['bash','pwsh'].includes(payload?.tool_name)||typeof command!=='string'||command.length>4096)return {};
  // Preserve shell syntax and machine-readable requests; users can explicitly use rtk proxy.
  if(/^(?:&\s+)?rtk(?:\.exe)?\s/i.test(command.trim())||/[\r\n;&|<>`$()%!^]/.test(command)
    ||/--(?:json|porcelain|format|pretty|name-only|name-status|numstat|null)\b|(?:^|\s)-z(?:\s|$)/.test(command))return {};
  // This is RTK's JSON formatter, not a Claude process or account integration.
  const reply=run(process.platform==='win32'?'rtk.exe':'rtk',['hook','claude'],{
    input:JSON.stringify({tool_name:'Bash',tool_input:{command}}),
    encoding:'utf8',shell:false,windowsHide:true,timeout:3000,maxBuffer:65536,
  });
  if(reply.error||reply.status!==0)throw Error('RTK hook processor failed');
  if(!reply.stdout?.trim())return {};
  const replacement=JSON.parse(reply.stdout).hookSpecificOutput?.updatedInput?.command;
  if(typeof replacement!=='string'||replacement===command||!/^rtk(?:\.exe)?\s/i.test(replacement))return {};
  return {decision:'block',reason:'RTK: the original command has NOT run. Resubmit this command once, preserving cwd and permissions: '+replacement};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    if(process.argv[2]==='context')console.log(JSON.stringify(rtkContext()));
    else {
      let text='';
      for await(const chunk of process.stdin){text+=chunk;if(text.length>1048576)throw Error('Hook input exceeds limit');}
      console.log(JSON.stringify(checkRtkCommand(JSON.parse(text))));
    }
  } catch(error){console.error(error.message);process.exitCode=1;}
}
