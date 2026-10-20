const { app, BrowserWindow, ipcMain } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
app.setPath("userData", process.env.DSH_REVIEW_USER_DATA);
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(
      '<html><body style="background:#dbeafe;padding:25px;font-family:sans-serif"><h1>Secure Electron annotation</h1><button id="review-target" class="action" style="background:#15803d;color:white;padding:30px;border-radius:12px;font-size:18px">REVIEW_NATIVE_OK</button></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const window = new BrowserWindow({
    width: 900,
    height: 720,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
      webviewTag: true,
      backgroundThrottling: false,
    },
  });
  const out = process.env.DSH_REVIEW_RESULT,
    timer = setTimeout(() => {
      fs.writeFileSync(out, JSON.stringify({ pass: false, error: "Timeout" }));
      app.exit(1);
    }, 45000);
  ipcMain.handle("review-resize", (_event, size) =>
    window.setSize(size.width, size.height),
  );
  ipcMain.handle("review-proof", async () => {
    fs.writeFileSync(
      process.env.DSH_REVIEW_PROOF,
      (await window.webContents.capturePage()).toPNG(),
    );
  });
  ipcMain.on("review-result", (_event, result) => {
    if (result.png) {
      fs.writeFileSync(
        process.env.DSH_REVIEW_PNG,
        Buffer.from(result.png.split(",")[1], "base64"),
      );
      delete result.png;
    }
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    clearTimeout(timer);
    server.close();
    window.destroy();
    app.exit(result.pass ? 0 : 1);
  });
  await window.loadFile(path.join(__dirname, "index.html"), {
    query: { fixture: "http://127.0.0.1:" + server.address().port },
  });
  window.showInactive();
});
