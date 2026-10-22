# sankey

分阶段的加权流向，2–3 列、≤ 12 个节点、≤ 16 条流。节点写成 `[名称, 列号]`，流写成 `[源下标, 目标下标, 数值]`；脚本按数值算节点高度，按来源的加权位置排布后续列（同列保持书写顺序），再画成带宽度的曲线带。流默认中性灰，`ON` 里列出的流及其两端节点变紫，作为唯一焦点。悬停一条流会淡出其他流。

```css
.sk .nd{fill:var(--text-muted)}
.sk .nd.on{fill:var(--brand)}
.sk .lk{fill:var(--text-muted);fill-opacity:.2}
.sk .lk.on{fill:var(--brand-text);fill-opacity:.45}
.sk svg:hover .lk{fill-opacity:.1}
.sk svg .lk:hover{fill-opacity:.5}
.sk .nl{paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
.sk .nm{fill:var(--text)}
```

```html
<div class="dui" data-w="user-flow">
<h2 class="sr-only">7,500 名新用户从四个渠道进入，4,300 人注册，其中 1,300 人付费</h2>
<div class="panel sk">
<div class="hd"><div class="ttl">新用户流向：7,500 人里 1,300 人付费</div><div class="sub">渠道 → 是否注册 → 30 天后状态，单位：人（示例数据）</div></div>
<svg viewBox="0 0 640 260" role="img" aria-label="新用户流向桑基图"></svg>
<div class="ft"><span><i class="dot"></i>紫色：注册后付费的 1,300 人</span><span class="r">带宽与人数成正比，悬停单独查看一股流</span></div>
</div></div>
<script>
(()=>{const r=document.querySelector('.dui[data-w="user-flow"]');if(!r||r.dataset.on)return;r.dataset.on=1;
const N=[['搜索',0],['社媒',0],['直接访问',0],['推荐',0],['注册',1],['流失',1],['付费',2],['活跃',2],['沉默',2]],
L=[[0,4,2000],[0,5,1200],[1,4,900],[1,5,1200],[2,4,1000],[2,5,500],[3,4,400],[3,5,300],[4,6,1300],[4,7,2100],[4,8,900]],
ON=[[4,6]],H=260,T=12,PAD=14,NW=10,X0=104,X1=526;
const ns=N.map(([n,c])=>({n,c,ins:[],outs:[]})),ls=L.map(([s,t,v])=>({s:ns[s],t:ns[t],v,on:ON.some(([a,b])=>a===s&&b===t)}));
ls.forEach(l=>{l.s.outs.push(l);l.t.ins.push(l)});
const sum=a=>a.reduce((x,o)=>x+o.v,0);
ns.forEach(n=>{n.v=Math.max(sum(n.ins),sum(n.outs));n.on=ls.some(l=>l.on&&(l.s===n||l.t===n))});
const C=Math.max(...ns.map(n=>n.c))+1,cols=[...Array(C)].map((_,c)=>ns.filter(n=>n.c===c));
const k=Math.min(...cols.map(col=>(H-2*T-PAD*(col.length-1))/sum(col)));
cols.forEach((col,c)=>{let y=T;col.forEach(n=>{n.x=X0+(X1-X0)*c/(C-1);n.h=n.v*k;
const want=c&&n.ins.length?n.ins.reduce((a,l)=>a+(l.s.y+l.s.h/2)*l.v,0)/sum(n.ins)-n.h/2:y;n.y=Math.max(y,want);y=n.y+n.h+PAD});
const over=y-PAD-(H-T);if(over>0)col.forEach(n=>n.y-=over)});
ns.forEach(n=>{let a=n.y,b=n.y;n.outs.sort((p,q)=>p.t.y-q.t.y).forEach(l=>{l.sy=a;a+=l.v*k});n.ins.sort((p,q)=>p.s.y-q.s.y).forEach(l=>{l.ty=b;b+=l.v*k})});
let h='';
ls.forEach(l=>{const w=l.v*k,x0=l.s.x+NW,x1=l.t.x,m=(x0+x1)/2;
h+=`<path class="lk${l.on?' on':''}" d="M${x0} ${l.sy}C${m} ${l.sy} ${m} ${l.ty} ${x1} ${l.ty}V${l.ty+w}C${m} ${l.ty+w} ${m} ${l.sy+w} ${x0} ${l.sy+w}Z"><title>${l.s.n} → ${l.t.n}：${l.v.toLocaleString()}</title></path>`});
ns.forEach(n=>{const e=n.c===0;
h+=`<rect class="nd${n.on?' on':''}" x="${n.x}" y="${n.y}" width="${NW}" height="${n.h}" rx="2"/><text class="txs nl" x="${e?n.x-6:n.x+NW+6}" y="${n.y+n.h/2+4}" text-anchor="${e?'end':'start'}"><tspan class="nm">${n.n}</tspan> ${n.v.toLocaleString()}</text>`});
r.querySelector('svg').innerHTML=h})();
</script>
```
