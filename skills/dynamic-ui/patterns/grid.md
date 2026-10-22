# grid

数值推演、逐格对照。`.g` 摆网格，`--n` 设列数；热度用 `--v`（按本图最大绝对值归一化）；小核用 `.g.sm`；各列用 `.vs` 纵向堆叠，整体用 `.hs` 横排。放不下一行时 `.hs` 会自动换行，不要缩小格子。

```html
<div class="dui" data-w="kernels">
<h2 class="sr-only">同一张 5×5 灰度图分别经过均值核、拉普拉斯核、锐化核后的 3×3 输出</h2>
<div class="panel">
<div class="hd"><div class="ttl">修图里的模糊、描边、锐化，就是三个卷积核</div><div class="sub">同一个 5×5 灰度图，换不同的核就得到不同的效果</div></div>
<div class="hs">
<div class="vs"><div class="g" style="--n:5">
<i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i>
<i class="cell">0</i><i class="cell" style="--v:1">9</i><i class="cell" style="--v:1">9</i><i class="cell" style="--v:1">9</i><i class="cell">0</i>
<i class="cell">0</i><i class="cell" style="--v:1">9</i><i class="cell" style="--v:1">9</i><i class="cell" style="--v:1">9</i><i class="cell">0</i>
<i class="cell">0</i><i class="cell" style="--v:1">9</i><i class="cell" style="--v:1">9</i><i class="cell" style="--v:1">9</i><i class="cell">0</i>
<i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i><i class="cell">0</i>
</div><div class="cap">输入 5×5（0 = 黑，9 = 白）</div></div>
<div class="vs"><div class="cap">均值核，每个 1/9</div>
<div class="g sm"><i class="cell">1</i><i class="cell">1</i><i class="cell">1</i><i class="cell">1</i><i class="cell">1</i><i class="cell">1</i><i class="cell">1</i><i class="cell">1</i><i class="cell">1</i></div>
<div class="cap">↓</div>
<div class="g"><i class="cell" style="--v:.44">4</i><i class="cell" style="--v:.67">6</i><i class="cell" style="--v:.44">4</i><i class="cell" style="--v:.67">6</i><i class="cell" style="--v:1">9</i><i class="cell" style="--v:.67">6</i><i class="cell" style="--v:.44">4</i><i class="cell" style="--v:.67">6</i><i class="cell" style="--v:.44">4</i></div>
<div class="lbl">模糊 / 磨皮</div></div>
<div class="vs"><div class="cap">拉普拉斯核</div>
<div class="g sm"><i class="cell">0</i><i class="cell">1</i><i class="cell">0</i><i class="cell">1</i><i class="cell">−4</i><i class="cell">1</i><i class="cell">0</i><i class="cell">1</i><i class="cell">0</i></div>
<div class="cap">↓</div>
<div class="g"><i class="cell" style="--v:1">−18</i><i class="cell" style="--v:.5">−9</i><i class="cell" style="--v:1">−18</i><i class="cell" style="--v:.5">−9</i><i class="cell">0</i><i class="cell" style="--v:.5">−9</i><i class="cell" style="--v:1">−18</i><i class="cell" style="--v:.5">−9</i><i class="cell" style="--v:1">−18</i></div>
<div class="lbl">描边 / 找边缘</div></div>
<div class="vs"><div class="cap">锐化核</div>
<div class="g sm"><i class="cell">0</i><i class="cell">−1</i><i class="cell">0</i><i class="cell">−1</i><i class="cell">5</i><i class="cell">−1</i><i class="cell">0</i><i class="cell">−1</i><i class="cell">0</i></div>
<div class="cap">↓</div>
<div class="g"><i class="cell" style="--v:1">27</i><i class="cell" style="--v:.67">18</i><i class="cell" style="--v:1">27</i><i class="cell" style="--v:.67">18</i><i class="cell" style="--v:.33">9</i><i class="cell" style="--v:.67">18</i><i class="cell" style="--v:1">27</i><i class="cell" style="--v:.67">18</i><i class="cell" style="--v:1">27</i></div>
<div class="lbl">锐化</div></div>
</div>
<div class="ft"><span>格里数字是该像素的灰度，底色深浅按各图自身数值归一化，便于一眼看出明暗分布。</span></div>
</div></div>
```
