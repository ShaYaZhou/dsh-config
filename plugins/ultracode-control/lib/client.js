// Ultracode 会话开关：模型选择器左侧的一枚状态药丸。
// 读：useProjection('ultracode') 给出会话显式记录，null 时回落到
// “Harness增强”设置页里的新会话默认值。写：只调用宿主已有的
// /ultracode on|off 命令，不新增记录类型或远程接口。
window.__ModuleLoader__.load({
  id: '@local/dsh-ultracode-control',
  factory: (require) => {
    const React = require('react'),
      h = React.createElement;
    const inject = ['slots', 'sessions', 'configForms'];
    const SETTINGS = 'enhancement-settings';
    // 与宿主模块 modules/ultracode.mjs 的判定保持一致：显式记录优先。
    function effectiveState(value, fallback) {
      if (value && typeof value.active === 'boolean') return value.active;
      return fallback === true;
    }
    // ConfigForm 快照里读新会话默认值；未提供服务时按关闭处理。
    function defaultOn(snapshot) {
      const value =
        snapshot?.value?.ultracodeDefault ??
        snapshot?.base?.ultracodeDefault;
      return value === true;
    }
    const STYLE = `
.uc-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:1px solid #8883;border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1;cursor:pointer;opacity:.72;transition:opacity .18s,border-color .18s,box-shadow .18s}
.uc-chip:hover:not(:disabled){opacity:1;border-color:#8886}
.uc-chip:disabled{cursor:default}
.uc-chip.on{opacity:1;color:#fff;border-color:transparent;background:linear-gradient(100deg,#6d5efc,#a86efc,#3ea8ff,#6d5efc);background-size:220% 100%;animation:uc-sheen 3.2s linear infinite;box-shadow:0 0 12px rgba(109,94,252,.55)}
.uc-dot{width:7px;height:7px;border-radius:999px;background:currentColor;opacity:.6}
.uc-chip.on .uc-dot{background:#fff;opacity:1;animation:uc-pulse 1.4s ease-in-out infinite}
.uc-err{font-size:12px;color:#e8463a}
@keyframes uc-sheen{from{background-position:0% 50%}to{background-position:200% 50%}}
@keyframes uc-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.6);opacity:.45}}
@media (prefers-reduced-motion:reduce){.uc-chip.on,.uc-chip.on .uc-dot{animation:none}}
`;
    function UltracodeChip({ useProjection, useUltracodeSetting, toggle }) {
      const projection = useProjection('ultracode');
      const active = effectiveState(projection, useUltracodeSetting(defaultOn));
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const act = () => {
        if (busy || typeof toggle !== 'function') return;
        setBusy(true);
        setError('');
        Promise.resolve(toggle(!active)).then(
          () => undefined,
          (failure) => setError(failure?.message || '切换失败'),
        ).finally(() => setBusy(false));
      };
      return h(
        React.Fragment,
        null,
        h('style', null, STYLE),
        h(
          'button',
          {
            type: 'button',
            className: active ? 'uc-chip on' : 'uc-chip',
            role: 'switch',
            'aria-checked': active,
            'aria-label': 'Ultracode 模式',
            title: active
              ? 'Ultracode 已开启：实质性任务默认用 workflow 编排。点击关闭'
              : 'Ultracode 已关闭。点击开启',
            disabled: busy,
            onClick: act,
          },
          h('span', { className: 'uc-dot', 'aria-hidden': true }),
          h('span', null, 'Ultracode'),
        ),
        error ? h('span', { className: 'uc-err', role: 'alert' }, error) : null,
      );
    }
    function apply(ctx) {
      const form = ctx.configForms.get(SETTINGS);
      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.right',
            id: 'ultracode-control',
            order: 10,
            inject: (sessionId) => ({
              hooks: { ultracodeSetting: form },
              toggle: (next) => {
                const live = ctx.sessions.binding(sessionId)?.session;
                if (live === undefined)
                  return Promise.reject(new Error('当前会话尚未就绪'));
                return live
                  .command(`/ultracode ${next ? 'on' : 'off'}`)
                  .then((result) => {
                    if (!result.ok)
                      throw new Error(
                        result.error?.message || 'ultracode 切换失败',
                      );
                    if (!result.value?.matched)
                      throw new Error('宿主未提供 /ultracode 命令');
                  });
              },
            }),
          },
          UltracodeChip,
        ),
      );
    }
    return { inject, apply };
  },
});
