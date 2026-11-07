# 渲染自检

用真实 React 做服务端渲染，把面板的两种视图都跑一遍——能抓到 `useState` 放错组件、
引用了不存在的变量、组件名拼错这类「语法检查看不出来」的错。

```bash
# 依赖（只装在临时目录，不进插件包）
mkdir -p /tmp/ttrender && cd /tmp/ttrender && npm init -y && npm i react@18 react-dom@18

# 快照数据（用线上接口取，或手写）
curl -s "http://127.0.0.1:57323/dsh-today-todo-api" -o snapshot.json
curl -s "http://127.0.0.1:57323/dsh-today-todo-api?from=2026-11-01&to=2026-11-21" -o range.json

# 跑
node ../../dsh-today-todo/test/render-check.mjs
```

脚本会自己复制一份 client.js 并加调试导出（生产包不动）。
