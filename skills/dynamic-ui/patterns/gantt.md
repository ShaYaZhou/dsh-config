# gantt

排期、依赖与关键路径，3–8 个任务，周刻度。纯 HTML：左侧任务栏，右侧时间轴；条的 `left` / `width` 写成占总工期的百分比（第 d 天 = d ÷ 总天数）。周网格线由 `--wk`（7 ÷ 总天数）决定。依赖线画在叠加层 SVG 里：横向按百分比、纵向按行高（每行 44，行中心 = 22 + 44 × 行号），先向右出一小截再下到下一行，末端藏进后继任务条下面。关键路径条用 `.on`（紫底白字写工期），其余浅紫；"今天"是一条紫色竖线。条带 `data-tip` 悬停看起止日期和进度。

```css
.gt{position:relative;display:grid;grid-template-columns:112px minmax(0,1fr);grid-template-rows:32px;grid-auto-rows:44px}
.gt .gh{align-self:end;padding-bottom:8px}
.gt .tk{position:relative}
.gt .tk>span{position:absolute;bottom:8px;padding-left:4px;font:400 12px/18px var(--sans);color:var(--text-muted);white-space:nowrap}
.gt .gn,.gt .gl{border-top:1px solid var(--border)}
.gt .gn{display:grid;align-content:center;padding-right:12px}
.gt .gl{position:relative}
.gt .gl>i{position:absolute;top:12px;height:20px;border-radius:4px;background:var(--s2);font:500 12px/20px var(--sans);text-align:center;white-space:nowrap}
.gt .gl>i.on{background:var(--brand);color:var(--brand-on)}
.gt .ov{position:absolute;left:112px;right:0;top:32px;bottom:0;background:linear-gradient(90deg,var(--border) 1px,transparent 1px) 0 0/var(--wk) 100%;pointer-events:none}
.gt .ov svg{position:absolute;inset:0;height:100%}
.gt .dp{fill:none;stroke:var(--text-muted);stroke-width:1.5;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.gt .td{position:absolute;top:24px;bottom:0;width:2px;margin-left:-1px;background:var(--brand);pointer-events:none}
```

```html
<div class="dui" data-w="launch">
<h2 class="sr-only">上线排期 7 月 1 日到 8 月 16 日，需求、设计、开发、联调四项首尾相接构成 41 天的关键路径，发布准备与联调并行</h2>
<div class="panel">
<div class="hd"><div class="ttl">上线排期：关键路径 41 天</div><div class="sub">7/1 – 8/16，周刻度；条内是工期，悬停看起止日期</div></div>
<div class="gt" style="--wk:15.217%">
<span class="cap gh">任务</span>
<div class="tk"><span style="left:0">7/1</span><span style="left:15.2%">7/8</span><span style="left:30.4%">7/15</span><span style="left:45.7%">7/22</span><span style="left:60.9%">7/29</span><span style="left:76.1%">8/5</span><span style="left:91.3%">8/12</span></div>
<div class="ov"><svg viewBox="0 0 100 220" preserveAspectRatio="none" aria-hidden="true"><path class="dp" d="M19.6 22H21V66H19.6"/><path class="dp" d="M41.3 66H42.7V110H41.3"/><path class="dp" d="M71.7 110H73.1V154H71.7"/></svg></div>
<div class="gn"><span>需求评审</span><span class="cap">产品</span></div><div class="gl"><i class="on" style="left:0;width:19.6%" data-tip="7/1 – 7/9 · 已完成">9 天</i></div>
<div class="gn"><span>交互设计</span><span class="cap">设计</span></div><div class="gl"><i class="on" style="left:19.6%;width:21.7%" data-tip="7/10 – 7/19 · 已完成">10 天</i></div>
<div class="gn"><span>前端开发</span><span class="cap">前端</span></div><div class="gl"><i class="on" style="left:41.3%;width:30.4%" data-tip="7/20 – 8/2 · 进度 30%">14 天</i></div>
<div class="gn"><span>联调测试</span><span class="cap">QA</span></div><div class="gl"><i class="on" style="left:71.7%;width:17.4%" data-tip="8/3 – 8/10 · 未开始">8 天</i></div>
<div class="gn"><span>发布准备</span><span class="cap">运维</span></div><div class="gl"><i style="left:82.6%;width:17.4%" data-tip="8/8 – 8/16 · 未开始"></i></div>
<i class="td" style="left:calc(112px + (100% - 112px) * .5)"></i>
</div>
<div class="ft"><span><i class="dot"></i>关键路径</span><span><i class="dot c2"></i>可并行</span><span class="r">紫色竖线：今天 7/24</span></div>
</div></div>
```
