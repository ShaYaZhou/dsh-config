window.__ModuleLoader__.load({id:'@local/dsh-desktop-commands',factory:()=>{
 const inject=['commandUi','sessions','uiWorkspace','remote','remote.agentPresets','remote.commands','conversation'];
 function apply(ctx){
  const ui=ctx.commandUi,workspace=ctx.uiWorkspace;
  const available=session=>!ctx.sessions.subagentAddress?.(session.sessionId);
  const add=(name,description,behavior)=>ctx.effect(()=>ui.register({name,label:()=>name,description:()=>description,available,ui:behavior}));
  const snapshot=id=>ctx.sessions.binding(id)?.session.getSnapshot();
  const clearToken=(session,name)=>{const scope=ctx.sessions.scope(session.sessionId);if(!scope)return;const input=ctx.conversation.input.for(scope);if(input.state?.getSnapshot().draft.trim()==='/'+name)input.setDraft('');};
  ctx.effect(()=>{
   // An asynchronously arriving command can otherwise leave a fuzzy skill selected on Enter.
   let navigated=false;
   const onInput=()=>{navigated=false;};
   const onKey=event=>{
    const composer=event.target?.closest?.('[data-composer-input]');if(!composer)return;
    if(['ArrowUp','ArrowDown','Tab'].includes(event.key)){navigated=true;return;}
    if(event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||event.isComposing||navigated)return;
    const name=/^\/([a-z][a-z0-9_-]*)$/.exec(composer.textContent.trim())?.[1];if(!name)return;
    const row=Array.from(document.querySelectorAll('[id^="dsh-slash-option-command-"]')).find(button=>Array.from(button.querySelectorAll('span')).some(span=>span.textContent.trim()===name));
    if(!row||row.disabled)return;
    event.preventDefault();event.stopImmediatePropagation();row.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}));
   };
   document.addEventListener('input',onInput,true);document.addEventListener('keydown',onKey,true);
   return ()=>{document.removeEventListener('input',onInput,true);document.removeEventListener('keydown',onKey,true);};
  });
  add('agents','选择持久 Agent 角色，或进入原生创建/编辑模式',{
   kind:'popupSelect',
   async options(){
    const result=await ctx.remote.agentPresets.list();if(!result.ok)throw new Error(result.error.message);
    return [...result.value.presets.filter(row=>!row.broken).map(row=>({id:row.id,label:row.name??row.id,detail:row.description??'在新会话中使用此角色'})),{id:'__creator',label:'创建或编辑 Agent…',detail:'进入原生 Creator，当前会话保留'}];
   },
   onSelect(option,session){clearToken(session,'agents');workspace.startSession(undefined,{agentPreset:option.id==='__creator'?'cordis':option.id,clearPreviousDraft:false});}
  });
  add('clear','清空上下文并开启新会话，原会话保留',{
   kind:'action',run(session){const preset=snapshot(session.sessionId)?.projectionValues?.agentPreset;workspace.startSession(undefined,{...(typeof preset==='string'?{agentPreset:preset}:{}),clearPreviousDraft:true});}
  });
  add('resume','选择并恢复已有会话',{
   kind:'popupSelect',
   async options(){return Object.values(ctx.sessions.list.getSnapshot().byId).filter(row=>!row.blank&&row.origin!=='subagent').sort((a,b)=>(b.updatedAt??0)-(a.updatedAt??0)).map(row=>({id:row.id,label:row.title||row.id,detail:row.cwd??''}));},
   onSelect(option,session){clearToken(session,'resume');workspace.openSession(option.id);}
  });
  add('fork','从当前会话创建独立分支',{
   kind:'popupSelect',async options(){return [{id:'create',label:'创建当前会话的分支',detail:'保留原会话，新分支独立继续'}];},
   async onSelect(_option,session){const child=await workspace.forkSession(session.sessionId);clearToken(session,'fork');workspace.openSession(child);}
  });
  add('help','查看可用命令及用法',{
   kind:'popupSelect',
   async options(session){
    const result=await ctx.remote.commands.list(session.sessionId);if(!result.ok)throw new Error(result.error.message);
    const rows=result.value.map(row=>({id:row.name,label:'/'+row.name,detail:row.description}));
    for(const [id,detail]of [['agents','选择角色/创建或编辑'],['clear','新会话，保留历史'],['resume','恢复历史会话'],['fork','创建当前会话分支'],['model','选择当前会话的模型']])rows.push({id,label:'/'+id,detail});
    return rows.filter(row=>!['rewind-plugin','snapshot-auto-cleanup'].includes(row.id));
   },
   onSelect(option,session){const scope=ctx.sessions.scope(session.sessionId);if(!scope)return;const input=ctx.conversation.input.for(scope);input.setDraft('/'+option.id+(option.id==='btw'?' ':''));input.focus();}
  });
 }
 return {inject,apply};
}});
