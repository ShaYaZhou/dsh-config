# sequence

两个对象之间按时间来回的消息，3–5 个参与方 × 4–8 条消息，从上往下读。实线是请求、虚线是响应；标签压在箭头上方 8px、居中于箭头；行距 50，640 宽下最多 8 行。紫色只给一条消息的箭头和标签（「哪一步是代价/风险所在」）。对象自己调自己时画右侧回环：`<path class="ms" d="M250 200h36v18h-36" marker-end="url(#sq)"/>`，标签写在回环右侧。活动条、条件框、并行分支都不画——那是 `svg-flow` 和正文的事。

```css
.sq .lf{stroke:var(--border);stroke-dasharray:3 4}
.sq .ab{fill:var(--surface-muted);stroke:var(--border)}
.sq .ms{fill:none;stroke:var(--text-muted);stroke-width:1.5;stroke-linecap:round}
.sq .ms.k{stroke:var(--brand);stroke-width:2}
.sq .ms.r{stroke-dasharray:4 4}
```

```html
<div class="dui" data-w="order">
<h2 class="sr-only">下单流程的四段消息：前端校验失败后重提，创建订单时冻结库存，库存口径是这条链的成本所在</h2>
<div class="panel sq">
<div class="hd"><div class="ttl">下单链路：成本压在冻结库存这一步</div><div class="sub">实线请求、虚线响应；从上往下是时间顺序</div></div>
<svg viewBox="0 0 640 352" role="img" aria-label="下单流程时序图">
<defs>
<marker id="sq" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="ah" d="M1 1L7 4L1 7Z"/></marker>
<marker id="sqb" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="ahb" d="M1 1L7 4L1 7Z"/></marker>
</defs>
<g>
<line class="lf" x1="110" x2="110" y1="48" y2="336"/><line class="lf" x1="250" x2="250" y1="48" y2="336"/>
<line class="lf" x1="390" x2="390" y1="48" y2="336"/><line class="lf" x1="530" x2="530" y1="48" y2="336"/>
<rect class="ab" x="50" y="8" width="120" height="32" rx="8"/><text class="txm" x="110" y="29" text-anchor="middle">用户</text>
<rect class="ab" x="190" y="8" width="120" height="32" rx="8"/><text class="txm" x="250" y="29" text-anchor="middle">前端</text>
<rect class="ab" x="330" y="8" width="120" height="32" rx="8"/><text class="txm" x="390" y="29" text-anchor="middle">订单服务</text>
<rect class="ab" x="470" y="8" width="120" height="32" rx="8"/><text class="txm" x="530" y="29" text-anchor="middle">库存库</text>
</g>
<g>
<path class="ms" marker-end="url(#sq)" d="M110 76H246"/><text class="txs" x="178" y="68" text-anchor="middle">提交订单</text>
<path class="ms r" marker-end="url(#sq)" d="M246 126H116"/><text class="txs" x="181" y="118" text-anchor="middle">校验失败</text>
<path class="ms" marker-end="url(#sq)" d="M110 176H246"/><text class="txs" x="178" y="168" text-anchor="middle">重新提交</text>
<path class="ms k" marker-end="url(#sqb)" d="M250 226H386"/><text class="txb" x="318" y="218" text-anchor="middle">创建订单</text>
<path class="ms" marker-end="url(#sq)" d="M390 276H526"/><text class="txs" x="458" y="268" text-anchor="middle">冻结库存</text>
<path class="ms r" marker-end="url(#sq)" d="M526 326H396"/><text class="txs" x="461" y="318" text-anchor="middle">冻结成功</text>
</g>
</svg>
<div class="ft"><span><i class="sw"></i>请求</span><span><i class="sw d"></i>响应</span><span class="r">紫色：这条链的成本所在</span></div>
</div></div>
```
