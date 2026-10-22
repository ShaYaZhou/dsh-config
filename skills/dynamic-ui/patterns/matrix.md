# matrix

矩阵算式：几组 `.g` 用 `.op`（`· = → ∗`）连成一行。焦点是 `.cell.k` 紫框格（这里是卷积核权重），结果格保持中性。副标题写维度公式并加 `.mono`。

```html
<div class="dui" data-w="wx">
<h2 class="sr-only">把 2×2 卷积核展开成 4×9 权重矩阵 W，与展平的输入 x 相乘得到 4 个输出并折回 2×2</h2>
<div class="panel">
<div class="hd"><div class="ttl">用展平后的数据做一次矩阵乘法</div><div class="sub mono">W (4×9) · x (9×1) = y (4×1) → 折回 2×2</div></div>
<div class="hs" style="gap:12px">
<div class="hs" style="gap:8px">
<div class="g sm"><i class="cell k">1</i><i class="cell k">2</i><i class="cell">0</i><i class="cell">0</i><i class="cell k">1</i><i class="cell k">2</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i></div>
<div class="g sm"><i class="cell k">3</i><i class="cell k">4</i><i class="cell">0</i><i class="cell">0</i><i class="cell k">3</i><i class="cell k">4</i><i class="cell k">1</i><i class="cell k">2</i><i class="cell">0</i><i class="cell">0</i><i class="cell k">1</i><i class="cell k">2</i></div>
<div class="g sm"><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell k">3</i><i class="cell k">4</i><i class="cell">0</i><i class="cell">0</i><i class="cell k">3</i><i class="cell k">4</i></div>
</div>
<span class="op">·</span>
<div class="g sm" style="--n:1"><i class="cell">1</i><i class="cell">2</i><i class="cell">0</i><i class="cell">3</i><i class="cell">1</i><i class="cell">4</i><i class="cell">0</i><i class="cell">2</i><i class="cell">5</i></div>
<span class="op">=</span>
<div class="g" style="--n:1"><i class="cell">18</i><i class="cell">21</i><i class="cell">13</i><i class="cell">35</i></div>
<span class="op">→</span>
<div class="g" style="--n:2"><i class="cell">18</i><i class="cell">21</i><i class="cell">13</i><i class="cell">35</i></div>
</div>
<div class="ft"><span>紫框是卷积核的 4 个权重，每下一行向右滑一格。</span><span class="r">行 = 输出位置，列 = 输入位置</span></div>
</div></div>
```
