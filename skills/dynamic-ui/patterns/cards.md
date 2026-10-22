# cards

方案对比、分档。2–4 张卡 × 3–5 行；推荐项标题变紫并带 `.pill.on`，其余卡保持中性；行内左标签右取值，值可换行。

```css
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 20px 8px}
.card:hover{border-color:color-mix(in srgb,var(--brand) 60%,var(--border))}
@media (prefers-reduced-motion:no-preference){.card{transition:border-color .12s}}
.card>.ttl{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:32px;margin-bottom:12px}
.card.rec>.ttl{color:var(--brand-text)}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:12px 0;border-top:1px solid var(--border)}
.row>:first-child{flex:none;font:400 12px/18px var(--sans);color:var(--text-muted)}
.row>:last-child{text-align:right}
```

```html
<div class="dui" data-w="tiers">
<h2 class="sr-only">小团队做后训练的三个投入档位对比，推荐进阶档</h2>
<div class="cards">
<div class="card"><div class="ttl">起步档</div>
<div class="row"><span>硬件</span><span>1 张 24G 卡</span></div>
<div class="row"><span>方法</span><span>SFT + DPO</span></div>
<div class="row"><span>工具</span><span>Unsloth、LLaMA-Factory</span></div>
<div class="row"><span>真实瓶颈</span><span>标注数据质量</span></div></div>
<div class="card rec"><div class="ttl">进阶档<span class="pill on">推荐</span></div>
<div class="row"><span>硬件</span><span>1–8 张卡</span></div>
<div class="row"><span>方法</span><span>+ RLVR / GRPO、蒸馏</span></div>
<div class="row"><span>工具</span><span>TRL、verl、Axolotl</span></div>
<div class="row"><span>真实瓶颈</span><span>可自动判定的 verifier</span></div></div>
<div class="card"><div class="ttl">重资产档</div>
<div class="row"><span>硬件</span><span>多机集群</span></div>
<div class="row"><span>方法</span><span>中训练、全量 RLHF</span></div>
<div class="row"><span>工具</span><span>自建训练栈</span></div>
<div class="row"><span>真实瓶颈</span><span>专职数据与评测团队</span></div></div>
</div></div>
```
