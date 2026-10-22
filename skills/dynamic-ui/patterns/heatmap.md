# heatmap

按天或时段的密度分布，行是星期（7 行），列是周（≤ 26 列）。数据按周依次写 7 个值（周一到周日），脚本从起始周一推算日期，生成月份标签、星期标签和格子；深浅按本图最大值归一化，峰值格加紫框。格子带 `data-tip` 悬停读数。页脚的"少 → 多"色阶与格子同色。

```css
.hm{display:grid;grid-template-columns:24px repeat(var(--w,26),16px);grid-auto-rows:16px;gap:4px;justify-content:center}
.hm>span{font:400 12px/16px var(--sans);color:var(--text-muted);white-space:nowrap}
.hm i,.lg i{position:relative;border-radius:4px;background:color-mix(in srgb,var(--s1) calc(var(--v,0)*100%),var(--surface-muted))}
.hm .pk{outline:2px solid var(--brand);outline-offset:1px}
.lg{display:inline-flex;align-items:center;gap:4px}
.lg i{display:inline-block;width:12px;height:12px}
```

```html
<div class="dui" data-w="commits">
<h2 class="sr-only">近 26 周每天的提交次数，7 月上旬冲刺期最密集，峰值是 7 月 9 日周四 14 次</h2>
<div class="panel">
<div class="hd"><div class="ttl">提交活跃度：7 月上旬冲刺最密</div><div class="sub">近 26 周，每格一天（示例数据）</div></div>
<div class="hm"></div>
<div class="ft"><span class="lg">少<i style="--v:0"></i><i style="--v:.25"></i><i style="--v:.5"></i><i style="--v:.75"></i><i style="--v:1"></i>多</span><span class="r">紫框：峰值 7/9（周四）14 次</span></div>
</div></div>
<script>
(()=>{const r=document.querySelector('.dui[data-w="commits"]');if(!r||r.dataset.on)return;r.dataset.on=1;
const D=[2,3,2,3,2,0,0,3,2,4,3,3,1,0,3,4,3,4,2,0,0,4,3,5,4,3,1,0,4,5,4,5,4,1,1,5,4,6,5,4,1,0,5,6,6,7,5,2,0,6,7,6,8,6,2,1,7,6,8,7,7,2,1,7,8,8,9,7,3,1,8,9,8,10,8,3,1,9,10,9,11,9,4,2,10,11,12,12,10,5,2,11,12,11,13,12,6,3,12,13,12,14,11,6,4,10,11,12,12,9,4,2,5,4,5,4,3,1,0,4,3,4,5,3,0,0,3,4,3,4,3,1,0,4,5,4,5,4,1,0,5,6,5,6,5,1,1,6,5,7,6,5,2,0,6,7,6,7,6,2,1,7,6,7,8,6,2,1,7,8,7,8,7,2,1,6,7,8,7,6,1,0],
t0=new Date(2026,2,30),W='一二三四五六日',N=D.length/7,mx=Math.max(...D);
const day=i=>{const d=new Date(t0);d.setDate(d.getDate()+i);return d};
let h='<span></span>';
for(let w=0;w<N;w++){const d=day(w*7);h+=`<span>${d.getDate()<=7?d.getMonth()+1+' 月':''}</span>`}
for(let k=0;k<7;k++){h+=`<span>${W[k]}</span>`;for(let w=0;w<N;w++){const i=w*7+k,d=day(i);h+=`<i${D[i]===mx?' class="pk"':''} style="--v:${(D[i]/mx).toFixed(2)}" data-tip="${d.getMonth()+1}/${d.getDate()} 周${W[k]} · ${D[i]} 次"></i>`}}
const g=r.querySelector('.hm');g.style.setProperty('--w',N);g.innerHTML=h})();
</script>
```
