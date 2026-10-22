# vflow

分阶段流程、成本梯度。左列阶段块（标题 + 一句说明），右列资源药丸，块间灰箭头；焦点是一条紫色虚线分界及其标签。不要分界线时就把焦点放到某个药丸（`.pill.on`）上。

```css
.vf{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:24px;align-items:center}
.vf>.cap{grid-column:1/-1;margin-bottom:12px}
.blk{grid-column:1;display:grid;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 20px}
.vf>.pill{grid-column:2;min-width:112px}
.vf>.ar{grid-column:1;justify-self:center;width:12px;height:32px}
.cut{grid-column:1/-1;display:grid;justify-items:center;gap:4px;margin:8px 0 16px;font:400 12px/18px var(--sans);color:var(--brand-text)}
.cut::after{content:"";justify-self:stretch;border-top:1.5px dashed var(--brand)}
```

```html
<div class="dui" data-w="pipeline">
<h2 class="sr-only">后训练流水线的四个阶段与资源门槛，小团队可达线以下从 SFT 开始</h2>
<div class="vf">
<div class="cap">后训练流水线：越往下越便宜，也越能拉开差距</div>
<div class="blk"><div class="bt">中训练 / 持续预训练</div><div class="cap">灌领域语料补知识底座，成本最高</div></div><span class="pill">多卡集群</span>
<div class="cut">小团队可达线</div>
<div class="blk"><div class="bt">SFT 监督微调</div><div class="cap">人类写标准答案，学格式与任务能力</div></div><span class="pill">单卡 24G</span>
<svg class="ar" viewBox="0 0 12 32" aria-hidden="true"><path class="ln" d="M6 2V24"/><path class="ah" d="M2 23L6 30L10 23Z"/></svg>
<div class="blk"><div class="bt">偏好优化（DPO / SimPO）</div><div class="cap">人类写 A/B 偏好对，省掉奖励模型与 RL 循环</div></div><span class="pill">单卡 24G</span>
<svg class="ar" viewBox="0 0 12 32" aria-hidden="true"><path class="ln" d="M6 2V24"/><path class="ah" d="M2 23L6 30L10 23Z"/></svg>
<div class="blk"><div class="bt">可验证奖励 RL（RLVR / GRPO）</div><div class="cap">对错能自动判定，靠在线采样自我提升</div></div><span class="pill">单卡 8G 起</span>
<svg class="ar" viewBox="0 0 12 32" aria-hidden="true"><path class="ln" d="M6 2V24"/><path class="ah" d="M2 23L6 30L10 23Z"/></svg>
<div class="blk"><div class="bt">策略蒸馏 OPD + 模型合并</div><div class="cap">大 teacher 教小 student，成本降一个量级</div></div><span class="pill">需 teacher</span>
</div></div>
```
