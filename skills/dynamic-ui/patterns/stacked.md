# stacked

每一类的总量和构成，2–4 段、≤ 8 行。纯 HTML：条长是本行总量占最大总量的百分比，段宽用 `flex` 直接写数值；段色按 `.c1` → `.c4` 顺序；段间 2px 缝隙分隔；每段带 `data-tip` 悬停读数。焦点行把标签换成 `.lbl`、合计换成 `.val.on`。

```css
.stk{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px 16px}
.sb{display:flex;gap:2px;height:12px}
.sb>i{position:relative;min-width:2px}
.sb>i:first-child{border-radius:999px 0 0 999px}
.sb>i:last-child{border-radius:0 999px 999px 0}
```

```html
<div class="dui" data-w="latency-mix">
<h2 class="sr-only">四个接口的耗时构成，匹配接口最慢，其中七成时间在排队</h2>
<div class="panel">
<div class="hd"><div class="ttl">接口耗时构成：匹配慢在排队</div><div class="sub">P50，单位 ms（示例数据）</div></div>
<div class="stk">
<span class="cap">登录</span><div class="sb" style="width:42.2%"><i class="c1" style="flex:12" data-tip="排队 12 ms"></i><i class="c2" style="flex:20" data-tip="计算 20 ms"></i><i class="c3" style="flex:6" data-tip="网络 6 ms"></i></div><span class="val">38</span>
<span class="lbl">匹配</span><div class="sb" style="width:100%"><i class="c1" style="flex:64" data-tip="排队 64 ms"></i><i class="c2" style="flex:18" data-tip="计算 18 ms"></i><i class="c3" style="flex:8" data-tip="网络 8 ms"></i></div><span class="val on">90</span>
<span class="cap">结算</span><div class="sb" style="width:62.2%"><i class="c1" style="flex:10" data-tip="排队 10 ms"></i><i class="c2" style="flex:34" data-tip="计算 34 ms"></i><i class="c3" style="flex:12" data-tip="网络 12 ms"></i></div><span class="val">56</span>
<span class="cap">商城</span><div class="sb" style="width:51.1%"><i class="c1" style="flex:8" data-tip="排队 8 ms"></i><i class="c2" style="flex:16" data-tip="计算 16 ms"></i><i class="c3" style="flex:22" data-tip="网络 22 ms"></i></div><span class="val">46</span>
</div>
<div class="ft"><span><i class="dot c1"></i>排队</span><span><i class="dot c2"></i>计算</span><span><i class="dot c3"></i>网络</span><span class="r">条长是总耗时</span></div>
</div></div>
```
