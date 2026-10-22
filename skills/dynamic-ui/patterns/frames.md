# frames

机制的多帧快照：同一坐标系下并排 3–4 帧，最后一帧给结果。形状描边用 `.ln` / `.ln.d`，被强调的量用 `.fb` 实心紫，基线用 `.ax`；帧下两行字：等宽参数 + 灰色读数。图例放页脚。

```css
.fl{fill:var(--text);font:500 13px var(--mono)}
```

```html
<div class="dui" data-w="conv">
<h2 class="sr-only">方波与方波做连续卷积，重叠面积随平移先增后减，结果是三角波</h2>
<div class="panel">
<div class="hd"><div class="ttl">连续卷积：方波卷方波得到三角形</div><div class="sub">f 与 g 都在 [0, 1] 上等于 1，x 每滑动一点，重叠面积就变一点</div></div>
<svg viewBox="0 0 640 114" role="img" aria-label="x 为 0.5、1、1.5 时的重叠面积，以及卷积结果三角波">
<path class="ax" d="M20 60H140M180 60H300M340 60H460M500 60H620"/>
<rect class="fb" x="60" y="20" width="20" height="40"/>
<rect class="ln" x="60" y="20" width="40" height="40"/>
<rect class="ln d" x="40" y="20" width="40" height="40"/>
<rect class="fb" x="220" y="20" width="40" height="40"/>
<rect class="ln" x="220" y="20" width="40" height="40"/>
<rect class="fb" x="400" y="20" width="20" height="40"/>
<rect class="ln" x="380" y="20" width="40" height="40"/>
<rect class="ln d" x="400" y="20" width="40" height="40"/>
<path class="ln b" d="M520 60L560 20L600 60"/>
<text class="fl" x="80" y="84" text-anchor="middle">x = 0.5</text><text class="txs" x="80" y="102" text-anchor="middle">面积 = 0.5</text>
<text class="fl" x="240" y="84" text-anchor="middle">x = 1</text><text class="txs" x="240" y="102" text-anchor="middle">面积 = 1</text>
<text class="fl" x="400" y="84" text-anchor="middle">x = 1.5</text><text class="txs" x="400" y="102" text-anchor="middle">面积 = 0.5</text>
<text class="fl" x="560" y="84" text-anchor="middle">(f ∗ g)(x)</text><text class="txs" x="560" y="102" text-anchor="middle">三角波</text>
</svg>
<div class="ft"><span><i class="sw"></i>f(u)：方波</span><span><i class="sw d"></i>g(x − u)：翻转平移后的核</span><span><i class="sw b"></i>重叠部分，面积就是积分值</span></div>
</div></div>
```
