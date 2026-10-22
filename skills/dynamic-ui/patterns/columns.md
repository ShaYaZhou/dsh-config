# columns

有序类目（月份、版本、阶段）上的两序列逐项对比，3–12 组。纯 HTML：柱高写成占纵轴上限的百分比，纵轴 5 个刻度对齐 4 条网格线（网格线由 `linear-gradient` 画成硬边细线，不是渐变效果）；焦点组加 `.on`，得到浅紫底带和紫色类目名；每根柱带 `data-tip` 悬停读数。

```css
.cb{--h:180px;display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:8px}
.cb .ya{display:flex;flex-direction:column;justify-content:space-between;height:calc(var(--h) + 18px);margin:-9px 0;font:400 12px/18px var(--mono);color:var(--text-muted);text-align:right}
.cb .pl,.cb .xa{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr))}
.cb .pl{height:var(--h);border-bottom:1px solid var(--border);background:linear-gradient(var(--border) 1px,transparent 1px) 0 0/100% 25%}
.cb .gp{display:flex;align-items:flex-end;justify-content:center;gap:4px}
.cb .gp.on{background:color-mix(in srgb,var(--brand) 10%,transparent);border-radius:8px 8px 0 0}
.cb .gp i{position:relative;width:14px;border-radius:4px 4px 0 0;background:var(--s1)}
.cb .gp i+i{background:var(--s2)}
.cb .xa{grid-column:2;margin-top:8px;text-align:center;font:400 12px/18px var(--sans);color:var(--text-muted)}
.cb .xa .on{color:var(--brand-text);font-weight:500}
```

```html
<div class="dui" data-w="tickets">
<h2 class="sr-only">上半年每月新建与关闭的工单数，5 月新建比关闭多 12 张，积压最多</h2>
<div class="panel">
<div class="hd"><div class="ttl">工单进出：5 月积压最多</div><div class="sub">单位：张，按月统计（示例数据）</div></div>
<div class="cb" style="--n:6">
<div class="ya"><span>80</span><span>60</span><span>40</span><span>20</span><span>0</span></div>
<div class="pl">
<div class="gp"><i style="height:52.5%" data-tip="1 月新建 42"></i><i style="height:47.5%" data-tip="1 月关闭 38"></i></div>
<div class="gp"><i style="height:68.75%" data-tip="2 月新建 55"></i><i style="height:62.5%" data-tip="2 月关闭 50"></i></div>
<div class="gp"><i style="height:76.25%" data-tip="3 月新建 61"></i><i style="height:65%" data-tip="3 月关闭 52"></i></div>
<div class="gp"><i style="height:60%" data-tip="4 月新建 48"></i><i style="height:62.5%" data-tip="4 月关闭 50"></i></div>
<div class="gp on"><i style="height:87.5%" data-tip="5 月新建 70"></i><i style="height:72.5%" data-tip="5 月关闭 58"></i></div>
<div class="gp"><i style="height:82.5%" data-tip="6 月新建 66"></i><i style="height:86.25%" data-tip="6 月关闭 69"></i></div>
</div>
<div class="xa"><span>1 月</span><span>2 月</span><span>3 月</span><span>4 月</span><span class="on">5 月</span><span>6 月</span></div>
</div>
<div class="ft"><span><i class="dot c1"></i>新建</span><span><i class="dot c2"></i>关闭</span><span class="r">浅紫底带：新建比关闭多出最多的月份</span></div>
</div></div>
```
