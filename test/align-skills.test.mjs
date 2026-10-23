import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ALIGNED_SKILLS, INLINE_SKILLS, annexCurrent, planSkill, syncSkill } from "../scripts/align-skills.mjs";

const repository = path.resolve(import.meta.dirname, "..");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "align-skills-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("复制的技能与仓库逐字节一致，第二次检查无待更新文件", (t) => {
  const target = tempDir(t);
  const status = planSkill("think", target);
  assert.equal(status.copy.length, 4);
  assert.equal(status.link, false);
  syncSkill(status);

  for (const file of status.files) {
    const installed = path.join(target, "think", file);
    assert.deepEqual(fs.readFileSync(installed), fs.readFileSync(path.join(repository, "skills/think", file)));
  }
  const again = planSkill("think", target);
  assert.equal(again.copy.length, 0);
  assert.deepEqual(again.localOnly, []);
});

test("目标含仓库没有的文件时拒绝覆盖", (t) => {
  const target = tempDir(t);
  syncSkill(planSkill("pua", target));
  fs.writeFileSync(path.join(target, "pua", "local-note.md"), "本机独有");
  const status = planSkill("pua", target);
  assert.deepEqual(status.localOnly, ["local-note.md"]);
  assert.throws(() => syncSkill(status), /仓库没有的文件/);
  assert.equal(fs.readFileSync(path.join(target, "pua", "local-note.md"), "utf8"), "本机独有");
});

test("目录联接被整棵替换为真实副本", (t) => {
  const target = tempDir(t);
  const source = path.join(repository, "skills", "pua");
  try {
    fs.symlinkSync(source, path.join(target, "pua"), "junction");
  } catch {
    t.skip("当前系统不允许创建目录联接");
    return;
  }
  const status = planSkill("pua", target);
  assert.equal(status.link, true);
  syncSkill(status);
  const installed = path.join(target, "pua");
  assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
  assert.deepEqual(fs.readFileSync(path.join(installed, "SKILL.md")), fs.readFileSync(path.join(source, "SKILL.md")));
});

test("文档附录与仓库技能保持一致", () => {
  const doc = fs.readFileSync(path.join(repository, "docs/SKILLS-ALIGNMENT.md"), "utf8");
  assert.match(doc, /<!-- annex:begin -->[\s\S]+<!-- annex:end -->/);
  assert.equal(annexCurrent(), true);
  for (const name of ALIGNED_SKILLS) {
    const head = fs.readFileSync(path.join(repository, "skills", name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n").slice(0, 40);
    if (INLINE_SKILLS.includes(name)) assert.ok(doc.includes(head), `附录缺少 ${name} 的 SKILL.md 开头`);
    else {
      assert.ok(doc.includes(`../skills/${name}/SKILL.md`), `附录缺少 ${name} 的仓库链接`);
      assert.ok(!doc.includes(head), `附录不应内联第三方技能 ${name}`);
    }
  }
});
