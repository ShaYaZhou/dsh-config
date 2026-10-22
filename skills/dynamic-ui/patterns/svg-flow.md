# svg-flow

模块关系、分支流程、调用链。先做坐标规划（SKILL.md §7）：本例节点高 56（标题基线 +24，副标题基线 +42），横向间距 48，`viewBox` 宽 640。主路径用 `.ln.b` + `#ahb`，其余用 `.ln` / `.ln.d` + `#ah`；连线说明写进目标节点副标题，不做悬空标签。

```html
<div class="dui" data-w="cache-flow">
<h2 class="sr-only">读请求经网关到服务，命中缓存直接返回，未命中才回源数据库</h2>
<div class="panel">
<div class="hd"><div class="ttl">读请求路径：先查缓存，未命中再回源</div><div class="sub">以一次商品详情读取为例</div></div>
<svg viewBox="0 0 640 180" role="img" aria-label="客户端到网关到服务，服务命中缓存或回源数据库">
<defs>
<marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="ah" d="M1 1L7 4L1 7Z"/></marker>
<marker id="ahb" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="ahb" d="M1 1L7 4L1 7Z"/></marker>
</defs>
<path class="ln b" d="M130 96H176" marker-end="url(#ahb)"/>
<path class="ln b" d="M288 96H334" marker-end="url(#ahb)"/>
<path class="ln b" d="M446 88C474 88 474 48 498 48" marker-end="url(#ahb)"/>
<path class="ln d" d="M446 104C474 104 474 144 498 144" marker-end="url(#ah)"/>
<rect class="n" x="20" y="68" width="110" height="56" rx="8"/>
<text class="txm" x="75" y="92" text-anchor="middle">客户端</text><text class="txs mono" x="75" y="110" text-anchor="middle">GET /item</text>
<rect class="n" x="178" y="68" width="110" height="56" rx="8"/>
<text class="txm" x="233" y="92" text-anchor="middle">网关</text><text class="txs" x="233" y="110" text-anchor="middle">鉴权 · 限流</text>
<rect class="n" x="336" y="68" width="110" height="56" rx="8"/>
<text class="txm" x="391" y="92" text-anchor="middle">服务</text><text class="txs" x="391" y="110" text-anchor="middle">组装响应</text>
<rect class="nb" x="500" y="20" width="120" height="56" rx="8"/>
<text class="txm" x="560" y="44" text-anchor="middle">缓存</text><text class="txb" x="560" y="62" text-anchor="middle">命中 · 约 1 ms</text>
<rect class="n" x="500" y="116" width="120" height="56" rx="8"/>
<text class="txm" x="560" y="140" text-anchor="middle">数据库</text><text class="txs" x="560" y="158" text-anchor="middle">未命中 · 约 20 ms</text>
</svg>
<div class="ft"><span><i class="dot"></i>紫线是命中缓存的主路径</span><span>虚线：未命中时回源</span></div>
</div></div>
```
