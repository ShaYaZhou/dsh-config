#!/usr/bin/env node
// 把仓库 skills/<名称> 复制到 agent 的全局技能目录，并刷新对齐文档的附录。
// 该脚本只做复制，不建立软链接或目录联接；目标里仓库没有的文件一律拒绝覆盖。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC_PATH = path.join(repository, "docs", "SKILLS-ALIGNMENT.md");
const ANNEX_BEGIN = "<!-- annex:begin -->";
const ANNEX_END = "<!-- annex:end -->";

// 只有这些技能同时属于「本机 agent 全局技能」；其余 skills/<名称> 仅由 DSH 安装器部署。
export const AGENT_SKILLS = ["dynamic-ui", "think", "pua"];
// 附录只内联自维护技能的全文；下载来的技能全文以仓库文件为准，文档只给链接。
export const INLINE_SKILLS = ["dynamic-ui"];

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

export function planSkill(name, targetRoot) {
  const source = path.join(repository, "skills", name);
  const target = path.join(targetRoot, name);
  const files = listFiles(source);
  const status = { name, source, target, files, copy: [], localOnly: [], link: false, blocked: false };
  if (!fs.existsSync(target)) {
    status.copy = files;
    return status;
  }
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    // 目录联接在 lstat 下同样报告为符号链接：整棵替换成真实副本。
    status.link = true;
    status.copy = files;
    return status;
  }
  if (!stat.isDirectory()) {
    status.blocked = true;
    return status;
  }
  for (const file of files) {
    const installed = path.join(target, file);
    if (!fs.existsSync(installed) || !sameFile(path.join(source, file), installed)) status.copy.push(file);
  }
  const known = new Set(files);
  status.localOnly = listFiles(target).filter((file) => !known.has(file));
  return status;
}

function removeLink(target) {
  // Windows 目录联接删除链接本身；unlink 在部分 Windows 版本会失败，回退到 rmdir。
  try {
    fs.unlinkSync(target);
  } catch {
    fs.rmdirSync(target);
  }
}

export function syncSkill(status) {
  if (status.blocked) throw new Error(`${status.target} 不是目录，需手工处理`);
  if (status.localOnly.length > 0) throw new Error(`${status.name} 目标含仓库没有的文件：${status.localOnly.join(", ")}`);
  if (status.link) removeLink(status.target);
  for (const file of status.copy) {
    const installed = path.join(status.target, file);
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.copyFileSync(path.join(status.source, file), installed);
  }
}

function fenceFor(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marks = "`".repeat(Math.max(3, longest + 1));
  return `${marks}markdown\n${text}\n${marks}`;
}

export function renderAnnex() {
  return AGENT_SKILLS.map((name) => {
    if (!INLINE_SKILLS.includes(name)) return `### ${name}\n\n第三方下载技能，全文以仓库文件为准：[skills/${name}/SKILL.md](../skills/${name}/SKILL.md)\n`;
    const text = fs.readFileSync(path.join(repository, "skills", name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n").trimEnd();
    return `### ${name}\n\n源文件：\`skills/${name}/SKILL.md\`\n\n${fenceFor(text)}\n`;
  }).join("\n");
}

function annexSlice(doc) {
  const begin = doc.indexOf(ANNEX_BEGIN);
  const end = doc.indexOf(ANNEX_END);
  return begin < 0 || end < begin ? undefined : doc.slice(begin + ANNEX_BEGIN.length, end);
}

export function annexCurrent() {
  if (!fs.existsSync(DOC_PATH)) return false;
  const slice = annexSlice(fs.readFileSync(DOC_PATH, "utf8"));
  return slice !== undefined && slice.trim() === renderAnnex().trim();
}

export function writeAnnex() {
  const doc = fs.readFileSync(DOC_PATH, "utf8");
  if (annexSlice(doc) === undefined) throw new Error("docs/SKILLS-ALIGNMENT.md 缺少 annex 标记");
  const begin = doc.indexOf(ANNEX_BEGIN) + ANNEX_BEGIN.length;
  const end = doc.indexOf(ANNEX_END);
  const next = `${doc.slice(0, begin)}\n\n${renderAnnex()}\n${doc.slice(end)}`;
  if (next !== doc) fs.writeFileSync(DOC_PATH, next);
}

function main(argv) {
  const check = argv.includes("--check");
  const index = argv.indexOf("--target");
  const targetRoot = index >= 0 ? path.resolve(argv[index + 1]) : path.join(os.homedir(), ".claude", "skills");
  let failed = false;
  console.log(`目标目录：${targetRoot}`);
  for (const name of AGENT_SKILLS) {
    const status = planSkill(name, targetRoot);
    if (status.blocked) {
      console.log(`${name}: 目标是文件而不是目录，需手工处理`);
      failed = true;
      continue;
    }
    if (status.localOnly.length > 0) {
      console.log(`${name}: 目标含仓库没有的文件，未覆盖（${status.localOnly.join(", ")}）`);
      failed = true;
      continue;
    }
    if (!check) syncSkill(status);
    const state = status.link ? `目录联接${check ? "待替换" : "已替换"}为真实副本` : status.copy.length === 0 ? "已一致" : `${status.copy.length} 个文件${check ? "待更新" : "已更新"}`;
    if (check && (status.link || status.copy.length > 0)) failed = true;
    console.log(`${name}: ${state}`);
  }
  const annex = annexCurrent();
  if (!annex && !check) writeAnnex();
  console.log(`文档附录：${annex ? "已一致" : check ? "与 skills/ 不一致" : "已刷新"}`);
  if (!annex && check) failed = true;
  if (failed) {
    console.log(check ? "检查未通过：运行不带 --check 的同一条命令完成对齐。" : "存在未处理的差异，见上。");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
