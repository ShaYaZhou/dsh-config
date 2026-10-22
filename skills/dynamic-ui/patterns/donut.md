# donut

少量类别（2–5 类）的占比，且总量有意义。静态 SVG：圆的半径取 15.9155，周长正好是 100，所以每段 `stroke-dasharray="占比−0.8 余下"`、`stroke-dashoffset="−前面各段占比之和"`，直接写百分比；0.8 是段间缝。SVG 整体转 −90° 从 12 点钟方向开始。中心放总量，右侧列表兼作图例；焦点类别用 `.lbl` 和 `.val.on`。悬停扇段看数值。

```css
.dn{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px 48px}
.dn .ring{position:relative;width:176px}
.dn svg{transform:rotate(-90deg)}
.dn .s{fill:none;stroke-width:6}
.dn .s:hover{stroke-width:7}
.dn .k1{stroke:var(--s1)}.dn .k2{stroke:var(--s2)}.dn .k3{stroke:var(--s3)}.dn .k4{stroke:var(--s4)}.dn .k0{stroke:var(--s0)}
.dn .ctr{position:absolute;inset:0;display:grid;place-content:center;justify-items:center}
.dn .num{font:500 16px/24px var(--mono)}
.dn .ls{display:grid;grid-template-columns:auto auto auto;align-items:center;gap:12px 24px}
```

```html
<div class="dui" data-w="vram">
<h2 class="sr-only">24 GB 显存的占用构成：模型权重 56%，激活 22%，KV 缓存 14%，其他 8%</h2>
<div class="panel">
<div class="hd"><div class="ttl">显存去哪了：一半多是模型权重</div><div class="sub">单卡 24 GB，推理峰值（示例数据）</div></div>
<div class="dn">
<div class="ring"><svg viewBox="0 0 42 42" role="img" aria-label="显存构成环形图">
<circle class="s k1" cx="21" cy="21" r="15.9155" stroke-dasharray="55.2 44.8" stroke-dashoffset="0"><title>模型权重 13.5 GB · 56%</title></circle>
<circle class="s k2" cx="21" cy="21" r="15.9155" stroke-dasharray="21.2 78.8" stroke-dashoffset="-56"><title>激活 5.2 GB · 22%</title></circle>
<circle class="s k3" cx="21" cy="21" r="15.9155" stroke-dasharray="13.2 86.8" stroke-dashoffset="-78"><title>KV 缓存 3.4 GB · 14%</title></circle>
<circle class="s k0" cx="21" cy="21" r="15.9155" stroke-dasharray="7.2 92.8" stroke-dashoffset="-92"><title>其他 1.9 GB · 8%</title></circle>
</svg><div class="ctr"><span class="num">24 GB</span><span class="cap">总显存</span></div></div>
<div class="ls">
<span class="lbl"><i class="dot c1"></i>模型权重</span><span class="val">13.5 GB</span><span class="val on">56%</span>
<span class="cap"><i class="dot c2"></i>激活</span><span class="val">5.2 GB</span><span class="val m">22%</span>
<span class="cap"><i class="dot c3"></i>KV 缓存</span><span class="val">3.4 GB</span><span class="val m">14%</span>
<span class="cap"><i class="dot c0"></i>其他</span><span class="val">1.9 GB</span><span class="val m">8%</span>
</div></div>
</div></div>
```
