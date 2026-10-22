# bars

量级比较、排名，≤ 8 项。三列网格：标签 / 轨道 / 数值（`.tr` `.bar` `.val` 在套件里）；宽度按最大值换算百分比；焦点那一条用 `.bar.on` 并把标签换成 `.lbl`，其余用浅紫。

```css
.bars{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px 16px}
```

```html
<div class="dui" data-w="build-time">
<h2 class="sr-only">四种构建方式的耗时对比，远程缓存最快</h2>
<div class="panel">
<div class="hd"><div class="ttl">构建耗时：远程缓存压到全量的十分之一</div><div class="sub">同一仓库、第二次构建（示例数据）</div></div>
<div class="bars">
<span class="cap">全量构建</span><div class="tr"><div class="bar" style="width:100%"></div></div><span class="val">184 s</span>
<span class="cap">增量构建</span><div class="tr"><div class="bar" style="width:23%"></div></div><span class="val">42 s</span>
<span class="cap">本地缓存</span><div class="tr"><div class="bar" style="width:14%"></div></div><span class="val">26 s</span>
<span class="lbl">远程缓存</span><div class="tr"><div class="bar on" style="width:9%"></div></div><span class="val">17 s</span>
</div></div></div>
```
