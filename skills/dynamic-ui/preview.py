"""dynamic-ui 预览与自检。

把 SKILL.md 的基础套件和 patterns/ 下的每个图元拼成完整 widget_code，
生成明暗对照页，并按 SKILL.md §3 / §4.2 的契约逐条检查。

用法：python preview.py [输出目录]   默认输出到系统临时目录下的 dynamic-ui-preview
退出码：自检有问题时为 1。
"""
import html
import json
import pathlib
import re
import sys
import tempfile

HERE = pathlib.Path(__file__).parent
KIT = re.search(r"```css\n(.*?)```", (HERE / "SKILL.md").read_text("utf-8"), re.S).group(1)
FONT_SCALE = {"12", "13", "14", "16"}
SPACE_SCALE = {"0", "1", "2", "4", "8", "12", "16", "20", "24", "32", "48"}
WEIGHTS = {"400", "500"}
KINDS = {"html", "svg", "script"}
ROOT = re.compile(r'<div class="dui" data-w="[^"]+">\s*<h2 class="sr-only">[^<]+</h2>')
HOSTS = {"light": "#FAF9F5", "dark": "#262624"}
PAGE = """<!doctype html><meta charset="utf-8"><title>dynamic-ui preview</title>
<style>body{margin:0;padding:24px;background:#8a8a8a;font:13px system-ui}h2{margin:0 0 8px;font:600 14px system-ui}
section{margin-bottom:32px}section>div{display:flex;flex-wrap:wrap;gap:16px}iframe{width:712px;border:0;border-radius:8px}</style>
<script>addEventListener("hashchange",()=>location.reload());addEventListener("DOMContentLoaded",()=>{const h=location.hash.slice(1);
if(h)for(const s of document.querySelectorAll("section"))s.id===h||s.remove()});
addEventListener("load",()=>{for(const f of document.querySelectorAll("iframe")){const d=f.contentDocument,
fit=()=>f.style.height=d.documentElement.offsetHeight+"px";fit();new ResizeObserver(fit).observe(d.body)}})</script>
"""


def widgets():
    for path in sorted((HERE / "patterns").glob("*.md")):
        src = path.read_text("utf-8")
        css = "".join(re.findall(r"```css\n(.*?)```", src, re.S))
        body = "".join(re.findall(r"```html\n(.*?)```", src, re.S))
        if body:
            yield path.stem, css + body, f"<style>\n{KIT}{css}</style>\n{body}"


def manifest(found):
    data = json.loads((HERE / "patterns" / "manifest.json").read_text("utf-8"))
    declared = {p.get("id"): p for p in data.get("patterns", [])}
    problems = [f"manifest: {pid} 没有对应图元文件" for pid in sorted(set(declared) - found)]
    problems += [f"manifest: 图元 {pid} 未登记" for pid in sorted(found - set(declared))]
    for pid, p in declared.items():
        if p.get("kind") not in KINDS:
            problems.append(f"manifest: {pid} 的 kind 必须是 html / svg / script")
        elif not p.get("intent"):
            problems.append(f"manifest: {pid} 缺 intent")
    return problems, {pid: p.get("kind") for pid, p in declared.items()}


def lint(name, code, kind):
    if not ROOT.search(code):
        yield f'{name}: 根节点不合契约，需要 <div class="dui" data-w="…"> 且首个子元素是 <h2 class="sr-only">…</h2>'
    for color in re.findall(r"#[0-9A-Fa-f]{3,8}\b", code):
        yield f"{name}: 写死颜色 {color}"
    sizes = re.findall(r"font(?:-size)?\s*:\s*(?:\d00\s+)?(\d+)px", code) + re.findall(r'font-size="(\d+)', code)
    for size in sizes:
        if size not in FONT_SCALE:
            yield f"{name}: 非刻度字号 {size}px"
    for weight in re.findall(r"font(?:-weight)?\s*:\s*(\d{3})\b", code):
        if weight not in WEIGHTS:
            yield f"{name}: 非刻度字重 {weight}"
    for prop, value in re.findall(r"(padding|margin|gap)(?:-[a-z]+)?\s*:\s*([^;}\"']+)", code):
        for n in re.findall(r"(-?\d+(?:\.\d+)?)px", value):
            if n.startswith("-"):
                continue  # 负值是光学修正，不属于节奏刻度
            if n not in SPACE_SCALE:
                yield f"{name}: {prop} 用了间距刻度外的 {n}px"
    if "position:fixed" in code.replace(" ", ""):
        yield f"{name}: 用了 position:fixed"
    if re.search(r"display\s*:\s*none", code):
        yield f"{name}: 用 display:none 藏内容"
    if "<!--" in code or "/*" in code:
        yield f"{name}: 含注释"
    if re.search(r"https?://", code) or re.search(r"@import|url\(\s*['\"]?http|<link\b", code):
        yield f"{name}: 引用外部资源（零网络）"
    if re.search(r"<\w+[^>]*\son[a-z]+\s*=", code):
        yield f"{name}: 写了内联事件 on*="
    scripts = code.count("<script")
    if scripts > 1:
        yield f"{name}: 有 {scripts} 个 <script>，只允许一个收尾脚本"
    elif kind == "script" and not scripts:
        yield f"{name}: manifest 标为 script 但示例没有脚本"
    elif kind != "script" and scripts:
        yield f"{name}: manifest 标为 {kind} 但示例含 <script>"
    if kind == "svg" and "<svg" not in code:
        yield f"{name}: manifest 标为 svg 但示例没有 <svg>"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.gettempdir()) / "dynamic-ui-preview"
    (out / "widgets").mkdir(parents=True, exist_ok=True)
    items = list(widgets())
    problems, kinds = manifest({name for name, _, _ in items})
    sections = []
    for name, code, widget in items:
        problems += lint(name, code, kinds.get(name))
        (out / "widgets" / f"{name}.html").write_text(widget, "utf-8")
        frames = []
        for mode, bg in HOSTS.items():
            doc = f'<!doctype html><html style="color-scheme:{mode}"><meta charset=utf-8><body style=margin:0;padding:16px;background:{bg}>{widget}'
            frames.append(f'<iframe title="{name} {mode}" srcdoc="{html.escape(doc)}"></iframe>')
        sections.append(f'<section id="{name}"><h2>{name}</h2><div>{"".join(frames)}</div></section>')
    (out / "index.html").write_text(PAGE + "".join(sections), "utf-8")
    print("\n".join(problems) or "自检通过")
    print(out / "index.html")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
