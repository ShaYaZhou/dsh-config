import {randomUUID} from 'node:crypto';
import {appendPluginRecord, SessionId} from '@deepseek-ai/dsh-session';

const RECORD = 'plugin:dsh-external-workflow/tool-filter';
export function checkedFilter(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !Object.keys(value).length || Object.entries(value).some(([key, list]) =>
            !['allow', 'deny'].includes(key) || !Array.isArray(list) || list.some(item => typeof item !== 'string')))
        throw new Error('Invalid persisted workflow tool restriction');
    return value;
}

// rc5 owns activation, messaging and cancellation. Keep the old upstream seam
// local to this package; restrictions are installed before the child's first step.
export function rc5Subagents(ctx) {
    const native = ctx.subagents, pending = new Map();
    ctx.on('agent/created', async ({agent}) => {
        const filter = pending.get(agent.id);
        const saved = agent.session.snapshotEvents().findLast(event => event.type === RECORD);
        if (filter === undefined && saved === undefined) return;
        agent.ctx.tools.restrict(checkedFilter(filter ?? saved.data));
        if (filter !== undefined && saved === undefined) {
            appendPluginRecord(agent.session, RECORD, filter);
            await ctx.sessions.flush(agent.session);
        }
    });
    return {
        getProvider(name) {
            const provider = native.getProvider(name);
            if (!provider) return undefined;
            return {...provider, capabilities:{...provider.capabilities, toolFilter:typeof provider.prepareContinuable === 'function'}};
        },
        async start(provider, input) {
            const {label = 'workflow', signal, toolFilter, ...request} = input;
            const local = typeof native.getProvider(provider)?.prepareContinuable === 'function';
            if (toolFilter !== undefined && !local) throw new Error('This backend cannot enforce workflow tool restrictions');
            const childId = local ? SessionId('session-' + randomUUID()) : undefined;
            if (toolFilter !== undefined) pending.set(childId, checkedFilter(toolFilter));
            let activation;
            try {
                activation = await native.startActivation({provider,label,request,signal,delivery:'caller',...(childId ? {childId} : {})});
            } finally { pending.delete(childId); }
            const abort = () => { activation.dispose().catch(error => ctx.logger.warn(String(error))); };
            signal.addEventListener('abort', abort, {once:true});
            if (signal.aborted) abort();
            return {
                id:activation.childId,
                localAgent:ctx.agents.get(activation.childId),
                result:activation.result.finally(() => signal.removeEventListener('abort', abort)),
                dispose:() => activation.dispose(),
                send:(text, signal) => native.sendMessage(input.parent, activation.childId, [{type:'text',text}], {signal}),
            };
        },
    };
}
