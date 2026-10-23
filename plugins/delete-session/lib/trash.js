import fs from "node:fs/promises";
import path from "node:path";

// 原生只有归档，没有删除接口（session-persistence 文档：剪枝属于带外维护）。
// 这里按带外维护的约定，把已停止并归档的会话目录整体移入回收站，不做 unlink。
const TRASH_DIR = "dsh-delete-session-trash";

async function findSessionDir(sessionsRoot, id) {
  let projects;
  try {
    projects = await fs.readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const candidate = path.join(sessionsRoot, project.name, id);
    try {
      if ((await fs.stat(candidate)).isDirectory()) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

// Windows 上刚停止的会话可能仍持有写句柄，rename 会短暂报 EPERM/EBUSY。
async function moveWithRetry(source, target) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      const transient = ["EPERM", "EBUSY", "EACCES"].includes(error.code);
      if (!transient || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

function trashStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function relocateSession(home, id, stamp = trashStamp()) {
  const source = await findSessionDir(path.join(home, "sessions"), id);
  if (source === null) return { moved: false, trashedTo: null };
  const target = path.join(home, TRASH_DIR, `${id}-${stamp}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await moveWithRetry(source, target);
  return { moved: true, trashedTo: target };
}
