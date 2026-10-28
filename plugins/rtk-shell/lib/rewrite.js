// Deliberately small grammar, not a shell parser. Unknown syntax is unchanged.
// Only human-readable, read-only Git queries are automatically compressed.
export function rewriteCommand(command) {
  if (typeof command !== "string" || /[\r\n\0]/.test(command)) return command;
  const words = command.trim().split(/[ \t]+/);
  if (words[0] !== "git") return command;
  const [, subcommand, ...args] = words;
  const flags = {
    status: new Set([]),
    diff: new Set(["--stat", "--cached", "--staged"]),
    log: new Set(["--oneline", "--stat", "--all"]),
    show: new Set(["--stat"]),
  }[subcommand];
  if (!flags) return command;
  for (let i = 0; i < args.length; i++) {
    if (flags.has(args[i])) continue;
    if (subcommand === "log" && /^-[1-9]\d{0,3}$/.test(args[i])) continue;
    if (subcommand === "log" && args[i] === "-n" && /^[1-9]\d{0,3}$/.test(args[i + 1] ?? "")) { i++; continue; }
    return command;
  }
  return "rtk " + command.trim();
}

export function rewriteSpec(spec) {
  // A stop before execution must not even enter the base executor.
  spec.signal?.throwIfAborted();
  const command = rewriteCommand(spec.command);
  return command === spec.command ? spec : { ...spec, command };
}
