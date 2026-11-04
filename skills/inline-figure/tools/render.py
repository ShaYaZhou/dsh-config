#!/usr/bin/env python3
"""render.py - 无头 Edge/Chrome 渲染 + 体检，给内联图 widget 用（亮/暗两套主题）。

用法:
  python render.py FILE [--kit kit.css|SKILL.md] [--out DIR] [--width 720] [--scale 1]
                       [--root .fg] [--name 名]

FILE:
  *.html  一个完整的 widget 片段（<style> + 标记 + 可选 <script>），原样渲染；所有 <style> 块都体检；
          带交付文件头的整份文件也行：doctype、meta、html、head、body 标签先去掉，渲染的是图本身
  *.md    图元文件：取其中所有 ```css 与 ```html 代码块，前面自动拼上 --kit 样式（只体检图元自己的 css 与 html）

选项:
  --kit    kit 样式（.css；或 .md 取第一个 css 块）。缺省：取工具目录上一层的 SKILL.md（随 skill 发布时的位置）；
           项目仓库里没有它时取仓库的 kit 样式文件；
           都没有就提示，只渲染图元自带的样式
  --out    输出目录，缺省为当前目录下的 fig-out（不存在会创建）
  --width  视口宽，缺省 720（页面两侧各留 16px，图的可用宽为宽度减 32）
  --scale  截图的设备像素比，缺省 1；只影响 PNG 的分辨率，体检结果不变
  --root   根节点选择器，缺省 .fg；越出根节点的检查以它为准，找不到则 FAIL
  --name   输出文件基名，缺省取输入文件名；只能是单个文件名（不能为空，不能含路径分隔符、冒号或 ..）；
           宽度不是 720 时自动再加 -w<宽度> 后缀（如 C01-w360）

环境变量:
  FIG_BROWSER     Edge 或 Chrome 的可执行文件；缺省依次找常见安装位置，再找 PATH 里的同名程序（跳过当前目录与相对的 PATH 项）
  FIG_NO_SANDBOX  设为 1 时加 --no-sandbox（任何平台都生效），并在 stderr 打印一行警告。Chrome 在 root 下拒绝带沙箱启动，
                  这是最后手段：只有渲染自己生成、不含外部脚本的内容时才可设，来源不可信的内容不要这样做

启动参数: Linux 上追加 --disable-dev-shm-usage（容器里 /dev/shm 通常很小），其他平台与旧版逐字相同。

输出（<名> 为基名；每次运行先删除 DIR 里同名的旧产物）:
  DIR/<名>-light.png  DIR/<名>-dark.png        亮、暗两张截图
  DIR/<名>.json                                体检结果
  DIR/_<名>-light.html  DIR/_<名>-dark.html    渲染用的页面副本

退出码: 0 = 没有 FAIL。1 = 有 FAIL 或前置条件不满足，分三种情形，修法不同:
  找不到 Edge / Chrome（或 FIG_BROWSER 指向的文件不存在）: 只有一行 stderr，图没有渲染，不是图的问题，装浏览器或改 FIG_BROWSER
  浏览器运行失败（无法启动、超时，或截图、体检结果没取到）: 不是图的问题，查浏览器与运行环境
  图有 FAIL（静态或页面体检），或 .md 里没有 html 代码块: 要修图
  第二、三种看第一条 FAIL 行：运行失败的行含「无法启动浏览器」「浏览器超时」「截图没生成」「没取到体检结果」，静态体检的 FAIL 排在最前。WARN 不影响退出码。

体检项（严重度以代码为准）:
  FAIL  脚本报错（含未处理的 Promise 拒绝）；
        HTML 文字对背景的对比度 < 3；position:fixed；内联事件处理器（onclick 等）；
        找不到根节点，或截图、体检结果没取到，或浏览器无法启动
  WARN  元素左右超出根节点 1.5px 以上；文字可能被裁切；HTML 文字对比度 < 4.5；
        文字小于 11.5px（按 CSS 字号计，SVG 文字也查，不计 SVG 缩放）；
        写死颜色 #xxx（.html 片段里 --名:值; 形式的自定义属性声明不算）；含注释；字号不在 12/13/14/16 刻度内（font-size、font 简写与 SVG font-size 都查）；字号单位不是 px
"""
import argparse
import html as H
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HOST = {"light": "#FAF9F5", "dark": "#262624"}
FONT_SCALE = {12, 13, 14, 16}
SIZE_WORDS = {"xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large", "smaller", "larger"}
BROWSER_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                 "microsoft-edge", "microsoft-edge-stable", "msedge", "chrome"]
BROWSER_TIMEOUT = 60
SANDBOX_HINT = "Chrome 在 root 下拒绝带沙箱启动；只有渲染自己生成、不含外部脚本的内容时才可设 FIG_NO_SANDBOX=1 重试，渲染来源不可信的内容不要这样做"
HERE = pathlib.Path(__file__).resolve().parent

HEAD_JS = r"""
window.__fge=[];
addEventListener('error',function(e){__fge.push(String(e.message||e.error||'error'))});
addEventListener('unhandledrejection',function(e){__fge.push('promise: '+e.reason)});
"""

PROBE_JS = r"""
(function(){
var ROOT=%ROOT%;
var M={errors:(window.__fge||[]).slice(),warns:[],fails:[],sizes:{},h:0},seen={};
function add(k,m){var key=k+m;if(seen[key])return;seen[key]=1;if(M[k+'s'].length<14)M[k+'s'].push(m)}
function d(el){var c=(typeof el.className==='string')?el.className.trim().split(/\s+/).join('.'):'';return el.tagName.toLowerCase()+(c?'.'+c:'')}
function parse(c){var m=c.match(/rgba?\(([^)]+)\)/);if(m){var p=m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat);return [p[0],p[1],p[2],p.length>3?p[3]:1]}
 m=c.match(/color\(srgb ([^)]+)\)/);if(m){var q=m[1].split(/[ \/]+/).filter(Boolean).map(parseFloat);return [q[0]*255,q[1]*255,q[2]*255,q.length>3?q[3]:1]}return null}
function over(t,b){var a=t[3];return [t[0]*a+b[0]*(1-a),t[1]*a+b[1]*(1-a),t[2]*a+b[2]*(1-a),1]}
function bgOf(el){var st=[];for(var e=el;e;e=e.parentElement){var c=parse(getComputedStyle(e).backgroundColor);if(c&&c[3]>0){st.push(c);if(c[3]>=0.99)break}}
 var cur=parse(getComputedStyle(document.body).backgroundColor)||[255,255,255,1];for(var i=st.length-1;i>=0;i--)cur=over(st[i],cur);return cur}
function lum(c){var f=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])}
function cr(a,b){var x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)}
addEventListener('load',function(){setTimeout(function(){
 try{
  var root=document.querySelector(ROOT);
  if(!root){add('fail','找不到根节点 '+ROOT)}
  else{
   var rr=root.getBoundingClientRect(),els=root.querySelectorAll('*');
   for(var i=0;i<els.length;i++){var el=els[i];if(el.closest('.fg-sr'))continue;
    var cs=getComputedStyle(el),r=el.getBoundingClientRect(),svg=el instanceof SVGElement;
    if(r.width>0&&r.height>0&&(r.right>rr.right+1.5||r.left<rr.left-1.5))add('warn','越出根节点: '+d(el));
    if(!svg&&(cs.overflowX==='hidden'||cs.overflow==='hidden')&&el.clientWidth>0&&el.scrollWidth>el.clientWidth+1)add('warn','文字可能被裁切: '+d(el));
    var has=false;for(var k=0;k<el.childNodes.length;k++){var n=el.childNodes[k];if(n.nodeType===3&&n.textContent.trim()){has=true;break}}
    if(!has)continue;
    var fs=parseFloat(cs.fontSize);M.sizes[fs]=(M.sizes[fs]||0)+1;
    if(fs<11.5)add('warn','文字小于 11.5px ('+fs+'px): '+d(el));
    if(!svg){var fg=parse(cs.color),bg=bgOf(el);if(fg&&bg){fg=over(fg,bg);var c=cr(fg,bg);
      if(c<3)add('fail','对比度 '+c.toFixed(1)+': '+d(el)+' "'+el.textContent.trim().slice(0,12)+'"');
      else if(c<4.5)add('warn','对比度 '+c.toFixed(1)+': '+d(el)+' "'+el.textContent.trim().slice(0,12)+'"')}}
   }
  }
 }catch(e){M.errors.push('probe: '+e)}
 M.errors.forEach(function(x){add('fail','JS 报错: '+x)});
 M.h=Math.ceil(document.documentElement.scrollHeight);
 var pre=document.createElement('pre');pre.id='__fgm';pre.style.display='none';pre.textContent=JSON.stringify(M);document.body.appendChild(pre);
},500)});
})();
"""


class BrowserNotFound(RuntimeError):
    pass


class BrowserLaunchError(RuntimeError):
    pass


def known_browsers():
    """当前平台的常见安装位置，按优先顺序。"""
    if sys.platform == "win32":
        paths = [
            os.path.join(root, vendor, browser, "Application", executable)
            for vendor, browser, executable in [("Microsoft", "Edge", "msedge.exe"), ("Google", "Chrome", "chrome.exe")]
            for root in [os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")]
            if root
        ]
        local = os.environ.get("LOCALAPPDATA")
        if local:
            paths += [os.path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
                      os.path.join(local, "Microsoft", "Edge", "Application", "msedge.exe")]
        return paths
    if sys.platform == "darwin":
        return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    return []


def find_browser():
    """依次查找：环境变量 FIG_BROWSER、常见安装位置、PATH 里的同名程序；都没有则抛 BrowserNotFound。"""
    env = os.environ.get("FIG_BROWSER")
    if env:
        if pathlib.Path(env).is_file():
            return env
        raise BrowserNotFound("FIG_BROWSER 指向的文件不存在: %s（应为 Edge 或 Chrome 的可执行文件）" % env)
    for p in known_browsers():
        if pathlib.Path(p).is_file():
            return p
    found = path_browser()
    if found:
        return found
    raise BrowserNotFound("找不到 Edge / Chrome：请安装，或设置环境变量 FIG_BROWSER 指向其可执行文件后重试")


def path_browser():
    """BROWSER_NAMES 依次在 PATH 各目录里找第一个可执行文件，没有则返回 None。
    不用 shutil.which：Windows 上它先查当前目录，会让当前目录的同名文件遮住 PATH 里真正的浏览器。
    相对的 PATH 项（含 ""、"."）相对当前目录解析，不查；当前目录本身也不查。"""
    cwd = os.path.normcase(os.path.realpath(os.getcwd()))
    dirs = [d for d in os.environ.get("PATH", "").split(os.pathsep)
            if os.path.isabs(d) and os.path.normcase(os.path.realpath(d)) != cwd]
    exts = [e for e in os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").split(";") if e] if os.name == "nt" else [""]
    for name in BROWSER_NAMES:
        for d in dirs:
            for ext in exts:
                p = os.path.join(d, name + ext)
                if os.path.isfile(p) and os.access(p, os.X_OK):
                    return p
    return None


def blocks(text, lang):
    """文本里全部 ```lang 代码块的内容，行尾归一为 LF。围栏大小写不敏感、lang 两侧可有空格、容忍 CRLF，与 cssscan.blocks 的规则相同；
    唯一差异是行尾：cssscan.blocks 保留 CRLF（已知有意的约定，断言见 test_render.BlocksParityTest）。"""
    return re.findall(r"```[ \t]*%s[ \t]*\n(.*?)```" % lang, text.replace("\r\n", "\n"), re.S | re.I)


def load_kit(path):
    p = pathlib.Path(path)
    if not p.is_file():
        return ""
    t = p.read_text("utf-8")
    if p.suffix == ".md":
        b = blocks(t, "css")
        return b[0] if b else ""
    return t


def default_kit(here):
    """缺省 kit：随 skill 发布时是工具目录上一层的 SKILL.md；项目仓库里是 ../impl/kit/kit.css；都没有返回空串。"""
    for p in (here.parent / "SKILL.md", here.parent / "impl" / "kit" / "kit.css"):
        if load_kit(p):
            return str(p)
    return ""


def kit_hint(here):
    """找不到 kit 时的提示，按工具目录上一层有没有 impl/ 来写：项目仓库才有 ../impl/kit/kit.css，随 skill 发布的版本只有上一层的 SKILL.md。"""
    if (here.parent / "impl").is_dir():
        return "发布版取上一层的 SKILL.md；项目仓库取 ../impl/kit/kit.css"
    return "应为上一层的 SKILL.md"


def font_token(value, shorthand):
    """声明值里的字号 token（不含行高）：font-size 取整个值；font 简写先去掉结尾的 !important（紧贴或隔空格都算），再跳过样式、字重、字宽，以及 oblique 的角度，取第一个带单位或为字号关键字的 token；没有则返回 None。"""
    if not shorthand:
        return value
    value = re.sub(r"!\s*important\s*$", "", value, flags=re.I)
    for t in value.split():
        w = t.lower().split("/")[0]
        if re.fullmatch(r"\d+(?:\.\d+)?(?:deg|grad|rad|turn)", w):
            continue
        if re.fullmatch(r"\d+(?:\.\d+)?[a-z%]+", w) or w in SIZE_WORDS:
            return t.split("/")[0]
    return None


def static_lint(css, body, kit_in_css):
    out = []
    code = css + "\n" + body
    if re.search(r"<!--|/\*", code):
        out.append("WARN 含注释（运行时约定：不写注释）")
    # kit 与图元同在一块 css 时，kit 的 token 定义 --名:值; 里的十六进制不算写死颜色
    hexcode = re.sub(r"--[\w-]+\s*:[^;{}]*;?", "", css) if kit_in_css else css
    for m in sorted(set(re.findall(r"#[0-9A-Fa-f]{3,8}\b", hexcode + "\n" + body))):
        out.append("WARN 写死颜色 %s（应引用 token）" % m)
    if re.search(r"position\s*:\s*fixed", code, re.I):
        out.append("FAIL 使用了 position:fixed")
    if re.search(r"<[a-zA-Z][^>]*\son[a-z]+\s*=", body, re.I):
        out.append("FAIL 内联事件处理器（onclick 等）")
    sizes, units, svg = set(), set(), set()
    for m in re.finditer(r"font(-size)?\s*:\s*([^;{}\"'<>]+)", code, re.I):
        tok = font_token(m.group(2).strip(), not m.group(1))
        if tok is None:
            continue
        px = re.match(r"(\d+(?:\.\d+)?)px", tok, re.I)
        if px:
            sizes.add(px.group(1))
        if not re.fullmatch(r"\d+(?:\.\d+)?px(?:\s*!important)?", tok):
            units.add(tok)
    for m in re.finditer(r'font-size="([^"]*)"', code, re.I):
        v = m.group(1).strip()
        num = re.fullmatch(r"(\d+(?:\.\d+)?)(?:px)?", v, re.I)
        if num:
            sizes.add(num.group(1))
        if not re.fullmatch(r"\d+(?:\.\d+)?(?:px)?", v):
            svg.add(v)
    for s in sorted(sizes, key=float):
        if float(s) not in FONT_SCALE:
            out.append("WARN 字号 %spx 不在刻度 12/13/14/16 内" % s)
    out += ["WARN 字号单位应为 px：%s" % v for v in sorted(units)]
    out += ["WARN 字号单位应为 px：%s" % v for v in sorted(svg)]
    return out


_WRAPPER = re.compile(r"<!doctype\b[^>]*>|<meta\b[^>]*>|</?(?:html|head|body)\b[^>]*>", re.I)


def unwrap(text):
    """去掉交付文件的外壳标签（doctype、meta、html、head、body）：它们不属于图。body 开标签的 style（max-width、margin:auto）
    会并进渲染页自己的 body，窄屏下把图推偏、裁切，而体检仍是 0 FAIL。"""
    return _WRAPPER.sub("", text)


def build_fragment(path, kit_path):
    text = path.read_text("utf-8")
    if path.suffix == ".md":
        css = "\n".join(blocks(text, "css"))
        body = "\n".join(blocks(text, "html"))
        if not body:
            sys.exit("%s 里没有 ```html 代码块" % path)
        if not css:
            print("提示: %s 里没有 ```css 代码块，样式只来自 kit" % path.name, file=sys.stderr)
        kit = load_kit(kit_path)
        if not kit:
            print("提示: 没找到 kit (%s)，只渲染图元自带的样式" % (kit_path or kit_hint(HERE)), file=sys.stderr)
        frag = "<style>\n%s\n%s</style>\n%s" % (kit, css, body)
        return frag, static_lint(css, body, False)
    text = unwrap(text)
    # 所有 <style> 块都体检（kit 与图元 css 通常同在第一块）
    css = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", text, re.S))
    body = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.S)
    return text, static_lint(css, body, True)


def page(fragment, mode, width, root):
    pad = 16
    return (
        '<!doctype html><html data-mode="%s" data-widget-theme="%s"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=%d"><style>html,body{margin:0}body{padding:%dpx;width:%dpx;background:%s}</style>'
        "<script>%s</script></head><body>%s<script>%s</script></body></html>"
        % (mode, mode, width, pad, width - 2 * pad, HOST[mode], HEAD_JS, fragment, PROBE_JS.replace("%ROOT%", json.dumps(root)))
    )


def output_name(base, width):
    return base if width == 720 else "%s-w%d" % (base, width)


def page_name(base, mode):
    """页面副本的文件名 _<基名>-<模式>.html。render 写出与清理副本、cdp.Page.open、harness.outputs 都经它生成，改命名规则只改这里。"""
    return "_%s-%s.html" % (base, mode)


def no_sandbox():
    return os.environ.get("FIG_NO_SANDBOX") == "1"


def is_root():
    return hasattr(os, "geteuid") and os.geteuid() == 0


def base_flags(prof):
    """render 与 cdp 共用的启动参数；平台与沙箱相关的参数见 platform_flags。"""
    return ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
            "--no-default-browser-check", "--user-data-dir=" + prof]


def platform_flags():
    """Linux 加 --disable-dev-shm-usage（容器里 /dev/shm 通常很小）；FIG_NO_SANDBOX=1 时加 --no-sandbox（任何平台）。"""
    flags = ["--disable-dev-shm-usage"] if sys.platform.startswith("linux") else []
    if no_sandbox():
        flags.append("--no-sandbox")
    return flags


def chrome_cmd(browser, prof, mode, extra, url):
    """启动命令：Windows 与 macOS 与旧版逐字相同；Linux 加 --disable-dev-shm-usage；FIG_NO_SANDBOX=1 时加 --no-sandbox。"""
    return [browser] + base_flags(prof) + [
        "--blink-settings=preferredColorScheme=%d" % (0 if mode == "dark" else 1),
    ] + platform_flags() + extra + [url]


def browser_launch_error(e):
    """浏览器无法启动（OSError）时的异常：render.py 与 cdp.py 共用这一条文案。"""
    return BrowserLaunchError("无法启动浏览器：%s（检查 FIG_BROWSER 是否指向可执行文件）" % e)


def run_browser(browser, url, mode, extra):
    """跑一次浏览器，返回 CompletedProcess；超时返回 None；无法启动抛 BrowserLaunchError。"""
    prof = tempfile.mkdtemp(prefix="fgprof")
    try:
        return subprocess.run(chrome_cmd(browser, prof, mode, extra, url), capture_output=True, timeout=BROWSER_TIMEOUT)
    except subprocess.TimeoutExpired:
        return None
    except OSError as e:
        raise browser_launch_error(e) from e
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def browser_failure(msg, stderr=b""):
    """浏览器运行失败的文案：root 且未设 FIG_NO_SANDBOX 时附提示；末尾附 stderr 的最后 200 个字符。"""
    if is_root() and not no_sandbox():
        msg += "；" + SANDBOX_HINT
    tail = stderr.decode("utf-8", "replace")[-200:]
    return msg + ("；浏览器 stderr 末尾: " + tail if tail else "")


def dom_metrics(browser, url, mode):
    """跑 --dump-dom 取体检结果，没取到就重试一次；返回 (体检, None) 或 (None, 失败文案)。"""
    r = None
    try:
        for _ in range(2):
            r = run_browser(browser, url, mode, ["--virtual-time-budget=6000", "--dump-dom"])
            if r is None:
                return None, browser_failure("浏览器超时（%d 秒），没取到体检结果" % BROWSER_TIMEOUT)
            m = re.search(r'<pre id="__fgm"[^>]*>(.*?)</pre>', r.stdout.decode("utf-8", "replace"), re.S)
            if m:
                return json.loads(H.unescape(m.group(1))), None
    except BrowserLaunchError as e:
        return None, str(e)
    return None, browser_failure("没取到体检结果（页面没跑完或浏览器报错）", r.stderr)


def screenshot(browser, url, mode, a, h, tpng):
    """截图到 tpng；成功返回 None，否则返回失败文案（空文件也算没生成）。"""
    try:
        r = run_browser(browser, url, mode, [
            "--virtual-time-budget=6000", "--force-device-scale-factor=%s" % a.scale,
            "--window-size=%d,%d" % (a.width, h), "--screenshot=" + str(tpng)])
    except BrowserLaunchError as e:
        return str(e)
    if r is None:
        return browser_failure("浏览器超时（%d 秒），截图没生成" % BROWSER_TIMEOUT)
    if not tpng.is_file() or tpng.stat().st_size == 0:
        return browser_failure("截图没生成", r.stderr)
    return None


def failed_mode(msg):
    return {"fails": [msg], "warns": [], "errors": [], "sizes": {}, "h": 0, "png": ""}


def render_mode(browser, fragment, mode, a, name, out, tmp):
    """渲染一个模式：页面副本拷进 out，取体检，截图先到 tmp 再拷进 out；返回该模式的记录（六个键齐全）。"""
    html = tmp / ("%s-%s.html" % (name[:40], mode))
    tpng = tmp / ("%s-%s.png" % (name[:40], mode))
    html.write_text(page(fragment, mode, a.width, a.root), "utf-8")
    shutil.copy(html, out / page_name(name, mode))
    url = html.as_uri()
    metrics, err = dom_metrics(browser, url, mode)
    if metrics is None:
        return failed_mode(err)
    png = out / ("%s-%s.png" % (name, mode))
    err = screenshot(browser, url, mode, a, max(metrics["h"], 40), tpng)
    if err:
        metrics["fails"].append(err)
        metrics["png"] = ""
    else:
        shutil.copy(tpng, png)
        metrics["png"] = str(png)
    return metrics


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("--kit")
    ap.add_argument("--out", default="fig-out")
    ap.add_argument("--width", type=int, default=720)
    ap.add_argument("--scale", type=float, default=1)
    ap.add_argument("--root", default=".fg")
    ap.add_argument("--name", help="输出文件基名，默认取输入文件名；只能是单个文件名")
    return ap.parse_args()


def clear_outputs(out, name):
    """删除 out 里本图元上一次运行的产物，失败的运行不能留下旧结果。"""
    for f in (out / ("%s-light.png" % name), out / ("%s-dark.png" % name), out / (name + ".json"),
              out / page_name(name, "light"), out / page_name(name, "dark")):
        f.unlink(missing_ok=True)


def prepare(a):
    """解析输入与输出路径、输出名和 kit，清掉旧产物；返回 (输出目录, 输出名, 片段, 静态检查结果)。--name 不合法时直接退出，不写任何文件。"""
    if a.name is not None and (not a.name or re.search(r"[/\\:]|\.\.", a.name)):
        sys.exit("--name 只能是单个文件名：不能为空，不能含路径分隔符、冒号或 ..（收到 %r）" % a.name)
    src = pathlib.Path(a.file).resolve()
    out = pathlib.Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    name = output_name(a.name or src.stem, a.width)
    clear_outputs(out, name)
    fragment, lint = build_fragment(src, a.kit or default_kit(HERE))
    return out, name, fragment, lint


def write_json(out, name, lint, modes):
    """体检结果写成 DIR/<名>.json，字段为 name、static、modes。"""
    (out / (name + ".json")).write_text(json.dumps({"name": name, "static": lint, "modes": modes}, ensure_ascii=False, indent=1), "utf-8")


def report(name, lint, modes):
    for x in lint:
        print("[static] " + x)
    for mode, m in modes.items():
        print("[%s %s] %dpx高  字号=%s  fails=%d warns=%d  %s" % (
            name, mode, m["h"], m["sizes"], len(m["fails"]), len(m["warns"]), m["png"]))
        for x in m["fails"]:
            print("   FAIL " + x)
        for x in m["warns"]:
            print("   WARN " + x)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    a = parse_args()
    if no_sandbox():
        print("警告: FIG_NO_SANDBOX=1，浏览器沙箱已关闭，仅用于渲染自己生成、不含外部脚本的内容", file=sys.stderr)
    out, name, fragment, lint = prepare(a)
    try:
        browser = find_browser()
    except BrowserNotFound as e:
        sys.exit(str(e))
    # 工作区的真实路径超过 200 字符，Edge 打不开超过 260 字符的路径，所以页面和截图先放短路径的临时目录，再拷回 --out；每次运行独立，结束即清理
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="fgr"))
    try:
        modes = {mode: render_mode(browser, fragment, mode, a, name, out, tmp) for mode in ("light", "dark")}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    failed = any(x.startswith("FAIL") for x in lint) or any(m["fails"] for m in modes.values())
    write_json(out, name, lint, modes)
    report(name, lint, modes)
    print("RESULT:", "FAILED" if failed else "OK")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
