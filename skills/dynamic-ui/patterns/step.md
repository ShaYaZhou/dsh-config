# step

单控件交互：静态 HTML 先画好第 0 步（不跑脚本也完整可读），脚本只负责切换。这里用"上一步 / 下一步"驱动滑动窗口：窗口格变紫框，对应输出格点亮，下方等宽算式同步更新。

```css
.ctl{display:flex;align-items:center;gap:8px;margin-top:20px}
.ctl button{font:500 12px/18px var(--sans);color:var(--text);background:var(--surface-muted);border:1px solid var(--border);border-radius:8px;padding:4px 12px;cursor:pointer}
.ctl button:hover{border-color:var(--brand)}
.ctl .cap{margin-left:8px}
```

```html
<div class="dui" data-w="slide">
<h2 class="sr-only">2×2 卷积核在 3×3 输入上逐格滑动，每一步得到一个输出值</h2>
<div class="panel">
<div class="hd"><div class="ttl">滑动窗口：核每走一步，算出一个输出</div><div class="sub">3×3 输入，2×2 核，步长 1</div></div>
<div class="hs">
<div class="vs"><div class="g" data-in><i class="cell k">1</i><i class="cell k">2</i><i class="cell">0</i><i class="cell k">3</i><i class="cell k">1</i><i class="cell">4</i><i class="cell">0</i><i class="cell">2</i><i class="cell">5</i></div><div class="cap">输入</div></div>
<span class="op">∗</span>
<div class="vs"><div class="g" style="--n:2"><i class="cell">1</i><i class="cell">2</i><i class="cell">3</i><i class="cell">4</i></div><div class="cap">卷积核</div></div>
<span class="op">=</span>
<div class="vs"><div class="g" style="--n:2" data-out><i class="cell" style="--v:1">18</i><i class="cell">21</i><i class="cell">13</i><i class="cell">35</i></div><div class="cap">输出</div></div>
</div>
<div class="ctl"><button type="button" data-d="-1">上一步</button><button type="button" data-d="1">下一步</button><span class="cap mono" data-f>1×1 + 2×2 + 3×3 + 1×4 = 18</span></div>
</div></div>
<script>
(()=>{const r=document.querySelector('.dui[data-w="slide"]');if(!r||r.dataset.on)return;r.dataset.on=1;
const X=[1,2,0,3,1,4,0,2,5],K=[1,2,3,4],inp=[...r.querySelectorAll('[data-in] .cell')],out=[...r.querySelectorAll('[data-out] .cell')],f=r.querySelector('[data-f]');let s=0;
const show=()=>{const o=(s>>1)*3+(s&1),w=[o,o+1,o+3,o+4];
inp.forEach((c,k)=>c.classList.toggle('k',w.includes(k)));out.forEach((c,k)=>c.style.setProperty('--v',k===s?1:0));
f.textContent=w.map((k,n)=>`${X[k]}×${K[n]}`).join(' + ')+' = '+w.reduce((a,k,n)=>a+X[k]*K[n],0)};
r.querySelector('.ctl').addEventListener('click',e=>{const d=+e.target.closest('button')?.dataset.d;if(!d)return;s=(s+d+4)%4;show()})})();
</script>
```
