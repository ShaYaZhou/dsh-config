# radar

2–3 个对象在同一组 3–8 个维度上的画像对比。数据写在脚本里，脚本生成四圈网格、轴线、维度标签和多边形；图形限宽 360 并居中，不随面板拉伸。去掉 `.r1` `.r2` `.r3` 的填充就是只描边的变体。悬停多边形显示该对象的全部分值。

```css
.rd svg{max-width:360px;margin:0 auto}
.rd .rg{fill:none;stroke:var(--border)}
.rd .rs{stroke-width:1.5;stroke-linejoin:round}
.rd .r1{fill:color-mix(in srgb,var(--s1) 22%,transparent);stroke:var(--s1)}
.rd .r2{fill:color-mix(in srgb,var(--s2) 36%,transparent);stroke:var(--s2)}
.rd .r3{fill:color-mix(in srgb,var(--s3) 22%,transparent);stroke:var(--s3)}
```

```html
<div class="dui" data-w="radar">
<h2 class="sr-only">两款模型在六个维度上的评分画像：A 偏代码与推理，B 偏速度与成本</h2>
<div class="panel rd">
<div class="hd"><div class="ttl">能力画像：A 强在代码，B 强在性价比</div><div class="sub">六项评测，满分 10（示例数据）</div></div>
<svg viewBox="0 0 360 260" role="img" aria-label="两款模型的六维雷达图"></svg>
<div class="ft"><span><i class="dot c1"></i>模型 A</span><span><i class="dot c2"></i>模型 B</span><span class="r">越靠外分越高</span></div>
</div></div>
<script>
(()=>{const r=document.querySelector('.dui[data-w="radar"]');if(!r||r.dataset.on)return;r.dataset.on=1;
const A=['代码','推理','长文本','多语言','速度','成本'],S=[['模型 A',[9,8,7,6,5,4]],['模型 B',[6,6,8,8,9,9]]],M=10,cx=180,cy=128,R=92;
const pt=(i,k)=>{const a=(i/A.length-.25)*2*Math.PI;return[cx+R*k*Math.cos(a),cy+R*k*Math.sin(a)]};
const pts=ks=>ks.map((k,i)=>pt(i,k).map(n=>n.toFixed(1)).join(',')).join(' ');
let h=[.25,.5,.75,1].map(k=>`<polygon class="rg" points="${pts(A.map(()=>k))}"/>`).join('');
A.forEach((a,i)=>{const[x,y]=pt(i,1),[lx,ly]=pt(i,1.18),t=Math.abs(lx-cx)<1?'middle':lx>cx?'start':'end';
h+=`<line class="rg" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="txs" x="${lx.toFixed(1)}" y="${(ly+4).toFixed(1)}" text-anchor="${t}">${a}</text>`});
S.forEach(([n,v],j)=>h+=`<polygon class="rs r${j+1}" points="${pts(v.map(x=>x/M))}"><title>${n}：${v.map((x,i)=>A[i]+' '+x).join('，')}</title></polygon>`);
r.querySelector('svg').innerHTML=h})();
</script>
```
