// This is a literal-command subset, not a general shell parser.
export const DEFAULTS = Object.freeze({
  enabled: true,
  git: true,
  logs: true,
  search: true,
  tests: true,
  excludedCommands: [],
  customRules: [],
});
export function literalCommand(command, dialect = "bash") {
  if (
    typeof command !== "string" ||
    command.length > 4096 ||
    /[\r\n\0;&|<>`$()%!^]/.test(command)
  )
    return null;
  if (dialect === "bash" && command.includes("\\")) return null;
  const tokens = [];
  let i = 0;
  while (i < command.length) {
    while (/[ \t]/.test(command[i] ?? "") && i < command.length) i++;
    if (i === command.length) break;
    const start = i,
      quote = command[i] === '"' || command[i] === "'" ? command[i++] : null;
    if (quote) {
      const end = command.indexOf(quote, i);
      if (end < 0) return null;
      const value = command.slice(i, end);
      if (!value || /["']/.test(value)) return null;
      i = end + 1;
      if (i < command.length && !/[ \t]/.test(command[i])) return null;
      tokens.push({ value, raw: command.slice(start, i), quoted: true });
    } else {
      while (i < command.length && !/[ \t]/.test(command[i])) i++;
      const value = command.slice(start, i);
      if (!/^[A-Za-z0-9_./:\\=@+,\-]+$/.test(value)) return null;
      tokens.push({ value, raw: value, quoted: false });
    }
  }
  if (
    !tokens.length ||
    tokens[0].quoted ||
    !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(tokens[0].value)
  )
    return null;
  if (
    new Set([
      "sh",
      "bash",
      "zsh",
      "cmd",
      "cmd.exe",
      "pwsh",
      "powershell",
      "sudo",
      "env",
      "rtk",
      "rtk.exe",
    ]).has(tokens[0].value.toLowerCase())
  )
    return null;
  return tokens;
}
export function validateSettings(input = {}) {
  const result = { ...DEFAULTS, ...input };
  for (const key of ["enabled", "git", "logs", "search", "tests"])
    if (typeof result[key] !== "boolean") throw Error("开关必须为布尔值");
  if (
    !Array.isArray(result.excludedCommands) ||
    result.excludedCommands.length > 50 ||
    result.excludedCommands.some(
      (x) => typeof x !== "string" || !x.trim() || x.length > 4096,
    )
  )
    throw Error("排除项最多50条，每条为完整命令");
  if (!Array.isArray(result.customRules) || result.customRules.length > 50)
    throw Error("自定义规则最多50条");
  const seen = new Set();
  for (const row of result.customRules) {
    if (
      !row ||
      typeof row.command !== "string" ||
      typeof row.enabled !== "boolean" ||
      !["summary", "err"].includes(row.filter)
    )
      throw Error("自定义规则格式错误");
    if (
      !literalCommand(row.command, "pwsh") ||
      ![
        "git",
        "node",
        "python",
        "python3",
        "npm",
        "pnpm",
        "cargo",
        "go",
        "rg",
        "grep",
        "pytest",
        "dotnet",
        "cmake",
        "ctest",
        "ruff",
        "tsc",
      ].includes(literalCommand(row.command, "pwsh")[0].value)
    )
      throw Error(
        "自定义规则仅支持单条字面命令，不支持脚本、变量、管道或重定向",
      );
    if (seen.has(row.command.trim())) throw Error("自定义命令重复");
    if (
      row.filter === "summary" &&
      testCommand(literalCommand(row.command, "pwsh"))
    )
      throw Error("测试命令请使用错误过滤，汇总可能误判通过数量");
    seen.add(row.command.trim());
  }
  return result;
}
// RTK summary/err re-enter sh or cmd. Serialize literal argv first, then pass
// the entire command as ONE argument so spaces are not lost by RTK's join().
function filtered(tokens, filter, dialect) {
  const quote = (value) =>
    '"' + (dialect === "pwsh" ? value.replace(/(\\+)$/g, "$1$1") : value) + '"';
  const inner = [
    tokens[0].value,
    ...tokens.slice(1).map((t) => quote(t.value)),
  ].join(" ");
  return `rtk ${filter} '${inner}'`;
}
function gitCommand(tokens) {
  const [, sub, ...args] = tokens.map((t) => t.value);
  if (tokens.some((t) => t.quoted)) return false;
  const flags = {
    status: [],
    diff: ["--stat", "--cached", "--staged"],
    log: ["--oneline", "--stat", "--all"],
    show: ["--stat"],
  }[sub];
  if (!flags) return false;
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i])) continue;
    if (sub === "log" && /^-[1-9]\d{0,3}$/.test(args[i])) continue;
    if (
      sub === "log" &&
      args[i] === "-n" &&
      /^[1-9]\d{0,3}$/.test(args[i + 1] ?? "")
    ) {
      i++;
      continue;
    }
    return false;
  }
  return true;
}
function searchCommand(tokens, dialect) {
  const [name, ...args] = tokens.map((t) => t.value);
  // Keep native search scope; never translate rg into RTK grep (different ignores).
  if (name === "rg") {
    if (
      !args.length ||
      args.some((a) =>
        /^(--json|--null|--null-data|--count|--count-matches|-c|-0|--quiet|-q|--replace|--pre|--pcre2|--stats|--help|--version)(=|$)/.test(
          a,
        ),
      )
    )
      return false;
    let positional = 0;
    for (let i = 0; i < args.length; i++) {
      if (
        [
          "-n",
          "--line-number",
          "-i",
          "--ignore-case",
          "-F",
          "--fixed-strings",
          "--files",
          "-l",
          "--files-with-matches",
        ].includes(args[i])
      )
        continue;
      if (
        ["-g", "--glob", "-t", "--type", "-e", "--regexp"].includes(args[i])
      ) {
        if (!args[++i]) return false;
        continue;
      }
      if (args[i].startsWith("-")) return false;
      positional++;
    }
    return positional > 0 || args.includes("--files");
  }
  if (name === "find" && dialect === "bash") {
    if (!args.length || args[0].startsWith("-")) return false;
    for (let i = 1; i < args.length; i += 2) {
      if (
        !["-name", "-iname", "-type", "-maxdepth", "-mindepth"].includes(
          args[i],
        ) ||
        !args[i + 1]
      )
        return false;
      if (
        ["-maxdepth", "-mindepth"].includes(args[i]) &&
        !/^\d{1,3}$/.test(args[i + 1])
      )
        return false;
      if (args[i] === "-type" && !["f", "d"].includes(args[i + 1]))
        return false;
    }
    return true;
  }
  return false;
}
function testCommand(tokens) {
  const [name, ...args] = tokens.map((t) => t.value);
  if (name === "node")
    return (
      args[0] === "--test" && args.slice(1).every((a) => !a.startsWith("-"))
    );
  if (name === "npm" || name === "pnpm")
    return (
      (args.length === 1 && ["test", "t"].includes(args[0])) ||
      (args.length === 2 &&
        args[0] === "run" &&
        /^test(?::[A-Za-z0-9_-]+)?$/.test(args[1]))
    );
  if (name === "pytest")
    return args.every(
      (a) =>
        ["-q", "-v", "-x", "--disable-warnings"].includes(a) ||
        !a.startsWith("-"),
    );
  if (name === "cargo")
    return (
      args[0] === "test" &&
      args
        .slice(1)
        .every((a) =>
          [
            "--lib",
            "--tests",
            "--workspace",
            "--all-features",
            "--quiet",
          ].includes(a),
        )
    );
  if (name === "go")
    return (
      args[0] === "test" &&
      args
        .slice(1)
        .every((a) => ["-v", "-race"].includes(a) || !a.startsWith("-"))
    );
  return false;
}
export function explainCommand(command, settings = DEFAULTS, dialect = "bash") {
  const config = validateSettings(settings);
  const unchanged = (reason) => ({
    command,
    rewritten: command,
    changed: false,
    reason,
  });
  if (!config.enabled) return unchanged("自动改写已关闭");
  if (config.excludedCommands.some((x) => x.trim() === command.trim()))
    return unchanged("命中精确排除项");
  const tokens = literalCommand(command, dialect);
  if (!tokens)
    return unchanged("复杂语法、已有RTK调用或不支持的命令，保持原样");
  const name = tokens[0].value;
  const custom = config.customRules.find(
    (r) => r.enabled && r.command.trim() === command.trim(),
  );
  if (custom)
    return {
      command,
      rewritten: filtered(tokens, custom.filter, dialect),
      changed: true,
      reason: "自定义精确匹配规则",
    };
  if (config.git && name === "git" && gitCommand(tokens))
    return {
      command,
      rewritten: "rtk " + command.trim(),
      changed: true,
      reason: "Git查询",
    };
  const logRead =
    (dialect === "bash" && name === "cat" && tokens.length === 2) ||
    (dialect === "pwsh" &&
      ["get-content", "cat", "gc", "type"].includes(name.toLowerCase()) &&
      tokens.length === 2);
  if (
    config.logs &&
    logRead &&
    /\.(log|txt)$/i.test(tokens[1].value) &&
    !tokens[1].value.startsWith("-") &&
    !/[\*?\[\]]/.test(tokens[1].value)
  )
    return {
      command,
      rewritten: "rtk log " + tokens[1].raw,
      changed: true,
      reason: "日志去重汇总（需要完整内容时用rtk proxy）",
    };
  if (config.search && searchCommand(tokens, dialect))
    return {
      command,
      rewritten: filtered(tokens, "summary", dialect),
      changed: true,
      reason: "保留搜索工具与范围，汇总输出",
    };
  if (config.tests && testCommand(tokens))
    return {
      command,
      rewritten: filtered(tokens, "err", dialect),
      changed: true,
      reason: "测试错误/警告过滤；保留退出码，不推断测试通过数量",
    };
  return unchanged("没有安全匹配的已启用规则");
}
export function rewriteCommand(command, settings = DEFAULTS, dialect = "bash") {
  if (typeof command !== "string") return command;
  return explainCommand(command, settings, dialect).rewritten;
}
export function rewriteSpec(spec, settings = DEFAULTS, dialect = "bash") {
  spec.signal?.throwIfAborted();
  if (spec.stdin !== undefined) return spec;
  const command = rewriteCommand(spec.command, settings, dialect);
  return command === spec.command ? spec : { ...spec, command };
}
