# funnel

有序阶段的逐级流失，3–7 个阶段。四列网格：阶段 / 条 / 人数 / 相对上一步的转化率；条长是相对首阶段的留存（`.tr` `.bar` `.val` 在套件里）。焦点是转化率最低的那一步：条用 `.bar.on`、标签换 `.lbl`、转化率换 `.val.on`，其余转化率用 `.val.m`。

```css
.fn{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:12px 16px}
```

```html
<div class="dui" data-w="signup-funnel">
<h2 class="sr-only">注册转化漏斗五个阶段，激活到付费这一步转化率最低，只有 25%</h2>
<div class="panel">
<div class="hd"><div class="ttl">注册漏斗：激活到付费这一步最漏</div><div class="sub">近 30 天新访客，单位：人（示例数据）</div></div>
<div class="fn">
<span class="cap">访问</span><div class="tr"><div class="bar" style="width:100%"></div></div><span class="val">12,400</span><span class="val m">—</span>
<span class="cap">注册</span><div class="tr"><div class="bar" style="width:54.8%"></div></div><span class="val">6,800</span><span class="val m">55%</span>
<span class="cap">激活</span><div class="tr"><div class="bar" style="width:47.6%"></div></div><span class="val">5,900</span><span class="val m">87%</span>
<span class="lbl">付费</span><div class="tr"><div class="bar on" style="width:12.1%"></div></div><span class="val">1,500</span><span class="val on">25%</span>
<span class="cap">复购</span><div class="tr"><div class="bar" style="width:7.3%"></div></div><span class="val">900</span><span class="val m">60%</span>
</div>
<div class="ft"><span>条长是相对访问的留存，最右列是相对上一步的转化率。</span></div>
</div></div>
```
