export const name='local-range-summary';
export const inject=['commands','compaction'];
export function apply(ctx){
 ctx.effect(()=>ctx.commands.register({name:'summarize-range',description:'Summarize before or from a selected user-message checkpoint, retaining the other part verbatim.',input:{hint:'before|from @<message-seq> [focus instructions]'},async handler(invocation){
  const match=/^(before|from)\s+@(\d+)(?:\s+([\s\S]+))?$/.exec(invocation.rawInput.trim());
  if(!match)return {kind:'error',text:'Usage: /summarize-range before|from @<user-message-seq> [focus]'};
  const {agent}=invocation;const seq=Number(match[2]);
  const nodes=agent.session.surface.nodes;
  const index=nodes.indexOf(seq);
  const events=agent.session.snapshotEvents();
  const event=events.find(e=>e.seq===seq);
  if(index<0||event?.type!=='user/message'||event.data.source.kind!=='user')return {kind:'error',text:'Target must be a currently visible user message.'};
  const first=events.find(e=>e.seq===nodes[0])?.type==='system/message'?1:0;
  const start=match[1]==='from'?index:first;
  const end=match[1]==='from'?nodes.length-1:index-1;
  if(start>end)return {kind:'success',text:'No messages in the selected range.'};
  const result=await ctx.compaction.compactNow(agent,invocation.signal,invocation.commandId,{start:nodes[start],end:nodes[end],instructions:match[3]});
  return {kind:'success',text:JSON.stringify(result)};
 }}));
}
