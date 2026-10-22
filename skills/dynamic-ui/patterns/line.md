# line

随时间的趋势，1–4 条线、2–24 个等距时间点。纯内联 SVG，脚本按数据算刻度并画网格、折线、端点和末值；第一条实线紫，其余换线型（虚线、点线、点划线），不只靠颜色区分。数据里的 `null` 表示缺测，折线在此断开而不是补 0。纵轴默认从 0 起；极差小于最大值 20% 时刻度会很挤，此时把 `Y0` 抬到刻度下沿，并在副标题写明纵轴不从 0 起。

```css
.tl .gd{stroke:var(--border)}
.tl .ln{stroke-width:2}
.tl .k1{stroke:var(--s1)}.tl .k2{stroke:var(--s2)}.tl .k3{stroke:var(--s3)}.tl .k4{stroke:var(--s4)}
.tl .d2{stroke-dasharray:5 4}.tl .d3{stroke-dasharray:1.5 3}.tl .d4{stroke-dasharray:6 3 1.5 3}
.tl .pt{stroke:var(--surface);stroke-width:1.5}
.tl .q1{fill:var(--s1)}.tl .q2{fill:var(--s2)}.tl .q3{fill:var(--s3)}.tl .q4{fill:var(--s4)}
.tl .hl{paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
```

```html
<div class="dui" data-w="trend">
<h2 class="sr-only">两款产品八周日活趋势，A 在第 5 周后持续拉开差距，B 基本走平</h2>
<div class="panel tl">
<div class="hd"><div class="ttl">日活趋势：A 在第 5 周后拉开差距</div><div class="sub">单位：万人，周均值（示例数据）</div></div>
<svg viewBox="0 0 640 240" role="img" aria-label="两款产品八周日活折线图">
<text class="txs" x="56" y="36">W1–W8 周均日活：A 12 → 30 万；B 11 → 17 万</text>
</svg>
<div class="ft"><span><i class="sw b"></i>产品 A</span><span><i class="sw d"></i>产品 B</span><span class="r">纵轴从 0 起，斜率可直接比较</span></div>
</div></div>
<script>
(()=>{const r=document.querySelector('.dui[data-w="trend"]');if(!r||r.dataset.on)return;r.dataset.on=1;
const L=['W1','W2','W3','W4','W5','W6','W7','W8'],
S=[['产品 A',[12,13,15,16,20,24,27,30]],['产品 B',[11,12,13,14,15,15,16,17]]],
U='万人',Y0=0,X=[56,620],Y=[200,28],f=v=>+v.toFixed(2);
const vals=S.flatMap(s=>s[1]).filter(v=>v!=null),mx=Math.max(...vals),mn=Math.min(...vals,Y0),
q=Math.max((mx-mn)/4,1e-9),p=10**Math.floor(Math.log10(q)),sy=[1,2,2.5,5,10].find(k=>k*p>=q)*p,
top=Math.max(Math.ceil(mx/sy-1e-9)*sy,mn+sy),
px=i=>L.length<2?X[0]:X[0]+(X[1]-X[0])*i/(L.length-1),
py=v=>Y[0]-(Y[0]-Y[1])*(v-mn)/(top-mn);
let h='';
for(let v=Math.ceil(mn/sy)*sy;v<=top+1e-9;v+=sy)h+=`<line class="gd" x1="${X[0]}" x2="${X[1]}" y1="${py(v)}" y2="${py(v)}"/><text class="txs mono" x="${X[0]-8}" y="${py(v)+4}" text-anchor="end">${f(v)}</text>`;
const step=Math.ceil(L.length/8);
L.forEach((l,i)=>{if(i%step===0||i===L.length-1)h+=`<text class="txs" x="${px(i)}" y="${Y[0]+18}" text-anchor="middle">${l}</text>`});
S.forEach(([n,d],j)=>{let run=[];
const flush=()=>{if(run.length>1)h+=`<path fill="none" class="ln k${j+1} ${j?'d'+(j+1):''}" d="M${run.join('L')}"/>`;run=[]};
d.forEach((v,i)=>{if(v==null){flush();return}run.push(`${px(i)} ${py(v)}`);h+=`<circle class="pt q${j+1}" cx="${px(i)}" cy="${py(v)}" r="3.5"><title>${n} ${L[i]}：${v} ${U}</title></circle>`});
flush();
const last=d.map((v,i)=>[v,i]).filter(a=>a[0]!=null).pop();
if(last)h+=`<text class="txs hl" x="${px(last[1])-4}" y="${py(last[0])-10}" text-anchor="end">${last[0]}</text>`});
h+=`<text class="txs" x="${X[0]}" y="14">单位：${U}</text>`;
r.querySelector('svg').innerHTML=h})();
</script>
```
