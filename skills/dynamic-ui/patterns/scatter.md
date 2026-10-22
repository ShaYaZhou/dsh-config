# scatter

两个数值指标的相关、聚类和离群点，1–4 组、≤ 200 个点。数据写在脚本里，脚本自动取整刻度，生成网格、坐标轴和点；各组按 `.p1` → `.p4` 取色，要说明的那个离群点用空心紫圈加一句标注（`F`，不需要就设为 `null`）。每个点可带第三个量 `[x,y,s]`，按 s 与最大值之比分三档半径 4 / 6 / 8，用来编气泡大小；没有第三维就统一 5。`XD` / `YD` 传上界数值可固定坐标范围，让同一组图之间能直接比大小（刻度间距仍按数据算；不传则自动取整）。静态兜底写一句区间，脚本跑完替换。

```css
.sc .gd{stroke:var(--border)}
.sc .pt{stroke:var(--surface);stroke-width:1.5}
.sc .p1{fill:var(--s1)}.sc .p2{fill:var(--s2)}.sc .p3{fill:var(--s3)}.sc .p4{fill:var(--s4)}
.sc .pf{fill:var(--surface);stroke:var(--brand);stroke-width:2}
.sc .hl{paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
```

```html
<div class="dui" data-w="latency">
<h2 class="sr-only">两种显卡上单张图耗时随分辨率近似线性上升，4090 有一次冷启动明显偏高</h2>
<div class="panel sc">
<div class="hd"><div class="ttl">出图耗时：像素翻倍，耗时约翻倍</div><div class="sub">SDXL，20 步，每个点是一次生成（示例数据）</div></div>
<svg viewBox="0 0 640 280" role="img" aria-label="分辨率与耗时散点图"><text class="txs" x="56" y="36">4090：1.2–4.6 s；3090：2.3–9.1 s（示例数据）</text></svg>
<div class="ft"><span><i class="dot c1"></i>RTX 4090</span><span><i class="dot c2"></i>RTX 3090</span><span class="r">空心紫圈：首次加载模型的冷启动</span></div>
</div></div>
<script>
(()=>{const r=document.querySelector('.dui[data-w="latency"]');if(!r||r.dataset.on)return;r.dataset.on=1;
const S=[['RTX 4090',[[.26,1.2],[.39,1.6],[.59,2.2],[.79,2.8],[1.05,3.6],[1.31,4.6]]],['RTX 3090',[[.26,2.3],[.39,3.1],[.59,4.4],[.79,5.6],[1.05,7.2],[1.31,9.1]]]],
F={x:1.05,y:9.8,t:'冷启动'},AX=['分辨率（百万像素）','耗时（s）'],X=[56,620],Y=[236,28],XD=null,YD=null;
const nice=m=>{const s=m/5,p=10**Math.floor(Math.log10(s)),k=[1,2,2.5,5,10].find(k=>k*p>=s)*p;return[k,Math.ceil(m/k-1e-9)*k]};
const all=S.flatMap(s=>s[1]).concat(F?[[F.x,F.y]]:[]),
[tx,xm]=nice(Math.max(...all.map(p=>p[0]))),[ty,ym]=nice(Math.max(...all.map(p=>p[1]))),
sx=tx,mx=XD||xm,sy=ty,my=YD||ym,sv=Math.max(...all.map(p=>p[2]||0)),
rad=v=>!sv||!v?5:4+2*(v/sv>=.66?2:v/sv>=.33?1:0);
const px=v=>X[0]+(X[1]-X[0])*v/mx,py=v=>Y[0]-(Y[0]-Y[1])*v/my,f=v=>+v.toFixed(2);
let h='';
for(let v=0;v<=my+1e-9;v+=sy)h+=`<line class="gd" x1="${X[0]}" x2="${X[1]}" y1="${py(v)}" y2="${py(v)}"/><text class="txs mono" x="${X[0]-8}" y="${py(v)+4}" text-anchor="end">${f(v)}</text>`;
for(let v=0;v<=mx+1e-9;v+=sx)h+=`<text class="txs mono" x="${px(v)}" y="${Y[0]+18}" text-anchor="middle">${f(v)}</text>`;
S.forEach(([n,ps],j)=>ps.forEach(([x,y,s])=>h+=`<circle class="pt p${j+1}" cx="${px(x)}" cy="${py(y)}" r="${rad(s)}"><title>${n}：${x} MP，${y} s${s?'，'+s:''}</title></circle>`));
if(F)h+=`<circle class="pf" cx="${px(F.x)}" cy="${py(F.y)}" r="6"><title>${F.t}：${F.x} MP，${F.y} s</title></circle><text class="txb hl" x="${px(F.x)+12}" y="${py(F.y)+4}">${F.t} ${F.y} s</text>`;
h+=`<text class="txs" x="${X[0]}" y="14">${AX[1]}</text><text class="txs" x="${X[1]}" y="${Y[0]+40}" text-anchor="end">${AX[0]}</text>`;
r.querySelector('svg').innerHTML=h})();
</script>
```
