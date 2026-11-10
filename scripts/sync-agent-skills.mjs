#!/usr/bin/env node
// 把仓库 skills/<名称> 同步到其他 agent 的全局技能目录（Claude Code、Codex）。
// DSH 侧只走 scripts/harness.mjs install；本脚本不写 DSH_HOME。
// 范围由 config/skill-sources.json 的 source 决定，不重复维护名单。
// 复制为真实文件，不建立软链接或目录联接；目标里出现仓库没有的文件即拒绝覆盖。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 需要同时装到其他 agent 的上游技能来源。
export const SYNCED_SOURCES = ["mattpocock/skills", "Aisland-SJL/Aisland-teach"];
// agent 名 → 该 agent 用户目录下的技能根（相对 home）。
export const AGENT_TARGETS = { claude: [".claude", "skills"], codex: [".codex", "skills"] };

export function syncedSkillNames() {
  const sources = JSON.parse(fs.readFileSync(path.join(repository, "config/skill-sources.json"), "utf8"));
  return Object.entries(sources)
    .filter(([, entry]) => SYNCED_SOURCES.includes(entry.source))
    .map(([name]) => name)
    .sort();
}

function listFiles(root, base = root, files = []) {
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) listFiles(full, base, files);
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files.sort();
}

function sameFile(a, b) {
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

function removeLink(target) {
  // Windows 目录联接删除链接本身；unlink 在部分 Windows 版本会失败，回退到 rmdir。
  try {
    fs.unlinkSync(target);
  } catch {
    fs.rmdirSync(target);
  }
}

export function planAgentSkill(name, targetRoot) {
  const source = path.join(repository, "skills", name);
  if (!fs.existsSync(source)) throw new Error(`仓库缺少技能：skills/${name}`);
  const target = path.join(targetRoot, name);
  const files = listFiles(source);
  if (!fs.existsSync(target)) return { name, source, target, files, copy: files, localOnly: [], link: false };
  if (fs.lstatSync(target).isSymbolicLink()) return { name, source, target, files, copy: files, localOnly: [], link: true };
  if (!fs.lstatSync(target).isDirectory()) throw new Error(`${target} 不是目录，需手工处理`);
  const copy = files.filter((file) => !fs.existsSync(path.join(target, file)) || !sameFile(path.join(source, file), path.join(target, file)));
  const known = new Set(files);
  return { name, source, target, files, copy, localOnly: listFiles(target).filter((file) => !known.has(file)), link: false };
}

export function applyAgentSkill(status, backupDir) {
  if (status.localOnly.length > 0) throw new Error(`${status.name} 目标含仓库没有的文件：${status.localOnly.join("、")}，需手工处理`);
  if (status.link || status.copy.length > 0) {
    if (fs.existsSync(status.target)) {
      // 整目录备份旧版本，避免只留部分文件导致回滚不完整。
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      for (const file of listFiles(status.target)) {
        const destination = path.join(backupDir, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(status.target, file), destination);
      }
    }
    if (status.link) removeLink(status.target);
    for (const file of status.copy) {
      const installed = path.join(status.target, file);
      fs.mkdirSync(path.dirname(installed), { recursive: true });
      fs.copyFileSync(path.join(status.source, file), installed);
    }
  }
  return status.link || status.copy.length > 0;
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function main(argv) {
  const check = argv.includes("--check");
  const apply = argv.includes("--apply");
  const homeIndex = argv.indexOf("--home");
  const home = homeIndex >= 0 ? path.resolve(argv[homeIndex + 1]) : os.homedir();
  const agentsIndex = argv.indexOf("--agents");
  const agents = agentsIndex >= 0 ? argv[agentsIndex + 1].split(",").map((name) => name.trim()).filter(Boolean) : Object.keys(AGENT_TARGETS);
  for (const agent of agents) if (!AGENT_TARGETS[agent]) throw new Error(`未知 agent：${agent}（可选 ${Object.keys(AGENT_TARGETS).join("、")}）`);
  const names = syncedSkillNames();
  const runStamp = stamp();
  let drift = 0;
  let blockers = 0;
  for (const agent of agents) {
    const root = path.join(home, ...AGENT_TARGETS[agent]);
    console.log(`${agent}：${root}`);
    for (const name of names) {
      const status = planAgentSkill(name, root);
      if (status.localOnly.length > 0) {
        blockers += 1;
        console.log(`  ${name}：目标含仓库没有的文件，未处理（${status.localOnly.join("、")}）`);
        continue;
      }
      if (status.link || status.copy.length > 0) drift += 1;
      const state = status.link
        ? `${apply ? "目录联接已替换为" : "目录联接待替换为"}真实副本`
        : status.copy.length === 0
          ? "已一致"
          : `${status.copy.length} 个文件${apply ? "已更新" : "待更新"}`;
      if (apply) applyAgentSkill(status, path.join(home, AGENT_TARGETS[agent][0], "skill-backups", `${name}.pre-sync-${runStamp}`));
      console.log(`  ${name}：${state}`);
    }
  }
  console.log(`技能 ${names.length} 项；差异 ${drift} 处；阻塞 ${blockers} 处。`);
  if (blockers > 0) {
    console.log("存在未处理的差异：先手工解决目标里的多余文件。");
    process.exitCode = 1;
    return;
  }
  if (check && drift > 0) {
    console.log("检查未通过：运行同一条命令加 --apply 完成同步。");
    process.exitCode = 1;
  } else if (!check && !apply) {
    console.log("未指定 --apply：只报告差异。");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
