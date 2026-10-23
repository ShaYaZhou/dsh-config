---
name: rtk-reference
description: 查看 RTK 命令包装器的完整命令参考。
disable-model-invocation: true
---

# RTK 命令参考

所有 Shell 命令都以 `rtk` 开头；命令链中的每一个命令也都加 `rtk`。RTK 没有专用过滤器时会透明传递原命令。

## 构建与检查

```bash
rtk cargo build
rtk cargo check
rtk cargo clippy
rtk tsc
rtk lint
rtk prettier --check
rtk next build
```

## 测试

```bash
rtk cargo test
rtk go test
rtk jest
rtk vitest
rtk playwright test
rtk pytest
rtk rake test
rtk rspec
rtk test <cmd>
```

## Git 与 GitHub

```bash
rtk git status
rtk git log
rtk git diff
rtk git show
rtk git add
rtk git commit
rtk git push
rtk git pull
rtk git branch
rtk git fetch
rtk git stash
rtk git worktree
rtk gh pr view <num>
rtk gh pr checks
rtk gh run list
rtk gh issue list
rtk gh api
```

## JavaScript 与 TypeScript

```bash
rtk pnpm list
rtk pnpm outdated
rtk pnpm install
rtk npm run <script>
rtk npx <cmd>
rtk prisma
```

## 文件、分析与调试

```bash
rtk ls <path>
rtk read <file>
rtk grep <pattern>
rtk find <pattern>
rtk err <cmd>
rtk log <file>
rtk json <file>
rtk deps
rtk env
rtk summary <cmd>
rtk diff
```

## 基础设施与网络

```bash
rtk docker ps
rtk docker images
rtk docker logs <container>
rtk kubectl get
rtk kubectl logs
rtk curl <url>
rtk wget <url>
```

## RTK 自身

```bash
rtk gain
rtk gain --history
rtk discover
rtk proxy <cmd>
rtk init
rtk init --global
```
