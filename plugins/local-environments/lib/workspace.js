import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export async function canonicalDirectory(value) {
  if (!path.isAbsolute(value))
    throw new Error("Bind an existing absolute folder on this computer");
  const canonical = await realpath(value);
  if (!(await stat(canonical)).isDirectory())
    throw new Error("Binding is not a directory");
  return canonical;
}

export async function localGit(ctx, cwd, args, signal) {
  signal.throwIfAborted();
  const task = ctx.subprocess.spawn({
    argv: ["git", "--no-optional-locks", "-C", cwd, ...args],
    cwd,
    signal,
    env: { GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
    graceMs: 1000,
    stdio: {
      stdin: "ignore",
      stdout: { maxBytes: 8192 },
      stderr: { maxBytes: 8192 },
    },
  });
  const outcome = await task.done;
  signal.throwIfAborted();
  const stdout = task.collected.stdout.readFrom(0);
  if (outcome.exitCode !== 0 || stdout.lossy)
    throw new Error(
      "Local Git reference cannot be resolved; check the folder and base ref",
    );
  return stdout.text.trim();
}

/** Resolve caller-validated repository choices before any retained checkout is allocated. */
export async function preflightRepositories(ctx, inputs, signal) {
  const repositories = [];
  for (const input of inputs) {
    if (!input.path) throw new Error("Bind a local folder for " + input.key);
    const sourceRoot = await canonicalDirectory(input.path);
    signal.throwIfAborted();
    let commit;
    if (input.worktree) {
      const root = await canonicalDirectory(
        await localGit(
          ctx,
          sourceRoot,
          ["rev-parse", "--show-toplevel"],
          signal,
        ),
      );
      if (root !== sourceRoot)
        throw new Error("Worktree bindings must point to the repository root");
      commit = await localGit(
        ctx,
        sourceRoot,
        [
          "rev-parse",
          "--verify",
          "--end-of-options",
          (input.from ?? "HEAD") + "^{commit}",
        ],
        signal,
      );
      if (!/^[a-f0-9]{40,64}$/.test(commit))
        throw new Error("Invalid resolved Git commit");
    }
    repositories.push({
      key: input.key,
      sourceRoot,
      cwd: sourceRoot,
      worktree: input.worktree,
      commit,
    });
  }
  return repositories;
}

/** Public native-workspace preparation shared by environments and user-confirmed follow-ups. */
export async function createRepositoryWorkspaces(
  ctx,
  repositories,
  signal,
  { permissionPreset, sessionIds = {} } = {},
) {
  const selected = repositories.map((repo) => ({ ...repo }));
  const preparationSessionIds = [];
  try {
    for (const repo of selected) {
      if (!repo.worktree) continue;
      signal.throwIfAborted();
      const requestedId = sessionIds[repo.key];
      const setup = await ctx.sessionController.create({
        cwd: repo.sourceRoot,
        ...(requestedId ? { sessionId: requestedId } : {}),
      });
      preparationSessionIds.push(setup.sessionId);
      if (requestedId && setup.sessionId !== requestedId)
        throw new Error(
          "The reserved preparation session was not reusable; inspect the retained sessions",
        );
      const { agent } = await ctx.sessionController.resolveAgent(
        setup.sessionId,
      );
      if (permissionPreset !== undefined) {
        ctx.permissionPresets.set(agent.session, permissionPreset);
        await ctx.sessions.flush(agent.session);
        signal.throwIfAborted();
      }
      const tree = await ctx.worktrees.create(
        agent,
        { from: repo.commit },
        signal,
      );
      repo.cwd = tree.path;
      repo.branch = tree.branch;
    }
    return { repositories: selected, preparationSessionIds };
  } catch (cause) {
    const hint = /Filename too long/i.test(cause.message)
      ? " Windows Git 路径过长；请在该仓库显式配置 core.longpaths=true，或绑定较短的目录后重试。"
      : "";
    const error = new Error(
      "Workspace preparation failed; retained session IDs: " +
        preparationSessionIds.join(", ") +
        ". " +
        cause.message +
        hint,
      { cause },
    );
    error.preparationSessionIds = preparationSessionIds;
    throw error;
  }
}
