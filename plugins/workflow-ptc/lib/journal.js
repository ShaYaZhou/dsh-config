import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const isWorkflowRunId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail = message => { throw new Error('Workflow recovery refused: ' + message); };
const stopFile = (root, owner) => join(root, 'stopped-' + createHash('sha256').update(owner).digest('hex') + '.json');

export function ownerStopped(root, owner) { return existsSync(stopFile(root, owner)); }
export function stopOwner(root, owner, runId) {
  mkdirSync(root, {recursive:true});
  writeFileSync(stopFile(root, owner), JSON.stringify({owner,runId}), {flush:true});
}
export function releaseOwner(root, owner) {
  const file=stopFile(root,owner);
  if(existsSync(file)) unlinkSync(file);
}

export function readRun(root, runId) {
  if(!root || !isWorkflowRunId(runId)) fail('invalid run ID or missing journal directory');
  const successor=join(root,runId+'.successor.json');
  if(existsSync(successor)) fail('run already has a successor; continue from that successor instead');
  let lines;
  try { lines=readFileSync(join(root,runId+'.jsonl'),'utf8').trimEnd().split('\n').map(line=>JSON.parse(line)); }
  catch { fail('journal is missing, truncated or corrupt; inspect file effects before starting new work'); }
  const header=lines.shift();
  if(header?.t!=='run' || header.v!==2 || header.runId!==runId || !header.identity?.owner || typeof header.script!=='string')
    fail('journal is legacy or has no verified identity');
  const entries=new Map();
  let end;
  for(const row of lines) {
    if(end) fail('journal contains records after its terminal record');
    if(row.t==='end') {
      if(!['completed','error','cancelled'].includes(row.stopReason)) fail('invalid terminal state');
      end=row; continue;
    }
    if(!Number.isSafeInteger(row.seq) || row.seq<1) fail('invalid call sequence');
    if(row.t==='intent') {
      if(entries.has(row.seq) || typeof row.prompt!=='string') fail('duplicate or invalid intent');
      entries.set(row.seq,{call:row});
    } else if(row.t==='call') {
      const entry=entries.get(row.seq);
      if(!entry || entry.childId || typeof row.childId!=='string') fail('invalid child activation');
      entry.childId=row.childId;
    } else if(row.t==='result') {
      const entry=entries.get(row.seq);
      if(!entry?.childId || entry.result || !Array.isArray(row.output) || typeof row.stopReason!=='string') fail('invalid child result');
      entry.result=row;
    } else fail('unrecognized journal record');
  }
  if(!end) fail('run has not quiesced or crashed; do not replay potentially applied writes');
  for(const entry of entries.values()) {
    if(entry.result?.stopReason!=='completed') fail('a child may have applied writes without a successful result; reconcile those files explicitly');
  }
  return {header,entries,end};
}

export class WorkflowJournal {
  constructor(root,runId,header,_log,resumeFrom) {
    if(!root) fail('safe execution requires the existing workflow journal');
    this.file=join(root,runId+'.jsonl');
    this.replay=new Map();
    this.pending=new Set();
    this.seen=new Set();
    this.replayed=new Set();
    mkdirSync(root,{recursive:true});
    let source;
    if(resumeFrom!==undefined) {
      source=readRun(root,resumeFrom);
      if(!isDeepStrictEqual(source.header.identity,header.identity) || source.header.script!==header.script || !isDeepStrictEqual(source.header.args,header.args))
        fail('session, directory, sandbox, model, script or inputs changed');
      if(existsSync(join(root,resumeFrom+'.successor.json'))) fail('run already has a successor; continue from that successor instead');
      this.replay=source.entries;
    }
    this.activeFile=join(root,'active-' + createHash('sha256').update(header.identity.owner).digest('hex') + '.json');
    this.runId=runId;
    try { writeFileSync(this.activeFile,JSON.stringify({runId}),{flag:'wx',flush:true}); }
    catch { fail('the owner already has an active or unconfirmed run; wait for cleanup or reconcile a crashed run'); }
    try {
      if(source) {
        // Keep the successor claim permanently: retrying an ancestor must not fork writes.
        writeFileSync(join(root,resumeFrom+'.successor.json'),JSON.stringify({runId}),{flag:'wx',flush:true});
      }
      writeFileSync(this.file,JSON.stringify({t:'run',v:2,runId,...header})+'\n',{flag:'wx',flush:true});
    } catch(error) {
      unlinkSync(this.activeFile);
      throw error;
    }
  }
  append(row) { appendFileSync(this.file,JSON.stringify(row)+'\n',{flush:true}); }
  takeReplay(request,provider) {
    const entry=this.replay.get(request.seq);
    if(!entry) {
      if(this.replayed.size!==this.replay.size) fail('script tried new work before replaying all completed calls');
      return undefined;
    }
    const expected={seq:request.seq,prompt:request.prompt,provider,model:request.model??null,schema:request.schema??null,...Object.fromEntries(["cwd","read_only","browser","session","reasoning_effort"].filter(key=>request[key]!==undefined).map(key=>[key,request[key]]))};
    const {t,...recorded}=entry.call;
    if(this.replayed.has(request.seq) || !isDeepStrictEqual(recorded,expected)) fail('replayed call changed or repeated');
    this.replayed.add(request.seq);
    this.seen.add(request.seq);
    // Copy the checkpoint so resuming a resumed run cannot lose completed work.
    this.append(entry.call);
    this.append({t:'call',seq:request.seq,childId:entry.childId});
    this.append(entry.result);
    return {childId:entry.childId,result:{output:entry.result.output,stopReason:'completed',...(entry.result.structured===undefined?{}:{structured:entry.result.structured}),tokens:0}};
  }
  get hasUnsettled() {return this.pending.size>0;}
  recordIntent(request,provider) {
    if(this.seen.has(request.seq)) fail('duplicate live call sequence');
    this.seen.add(request.seq);
    this.append({t:'intent',seq:request.seq,prompt:request.prompt,provider,model:request.model??null,schema:request.schema??null,...Object.fromEntries(["cwd","read_only","browser","session","reasoning_effort"].filter(key=>request[key]!==undefined).map(key=>[key,request[key]]))});
    this.pending.add(request.seq);
  }
  recordCall(request,_provider,childId) { this.append({t:'call',seq:request.seq,childId}); }
  recordResult(seq,result) { this.append({t:'result',seq,output:result.output,stopReason:result.stopReason,...(result.structured===undefined?{}:{structured:result.structured})}); this.pending.delete(seq); }
  finish(result) {
    this.append({t:'end',stopReason:result.stopReason,...(result.error?{error:result.error}:{})});
    if(JSON.parse(readFileSync(this.activeFile,'utf8')).runId!==this.runId) fail('active run ownership changed');
    unlinkSync(this.activeFile);
  }
}
