const { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const appOrigin = "iledger://app";
const webRoot = path.resolve(__dirname, "../dist");

function validateAppSender(event) {
  if (!event.sender.getURL().startsWith(`${appOrigin}/`)) throw new Error("请求来源无效");
}

function loginFile() {
  return path.join(app.getPath("userData"), "webdav-login.bin");
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "iledger",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function localFileFor(requestUrl) {
  const url = new URL(requestUrl);
  if (url.protocol !== "iledger:" || url.host !== "app") return null;

  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(webRoot, relativePath);
  if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${path.sep}`)) return null;
  return filePath;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "iLedger",
    backgroundColor: "#ffffff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${appOrigin}/`)) event.preventDefault();
  });
  window.loadURL(`${appOrigin}/index.html`);
}

app.whenReady().then(() => {
  ipcMain.handle("iledger:webdav-auth:load", async (event) => {
    validateAppSender(event);
    let encrypted;
    try { encrypted = await fs.readFile(loginFile()); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("设备安全存储不可用，无法恢复 WebDAV 登录");
    return JSON.parse(safeStorage.decryptString(encrypted));
  });
  ipcMain.handle("iledger:webdav-auth:save", async (event, credentials) => {
    validateAppSender(event);
    if (!credentials || !["jianguoyun", "custom"].includes(credentials.provider)
      || ["endpoint", "username", "password"].some((key) => typeof credentials[key] !== "string" || credentials[key].length > 4096)
      || !credentials.password) throw new Error("WebDAV 登录资料无效");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("设备安全存储不可用，未保存 WebDAV 密码");
    const target = loginFile();
    const temporary = `${target}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, safeStorage.encryptString(JSON.stringify(credentials)), { mode: 0o600 });
    await fs.rename(temporary, target);
  });
  ipcMain.handle("iledger:webdav-auth:clear", async (event) => {
    validateAppSender(event);
    try { await fs.unlink(loginFile()); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  });
  ipcMain.handle("iledger:webdav-request", async (event, request) => {
    validateAppSender(event);
    if (!request || typeof request.url !== "string" || !["PROPFIND", "MKCOL", "GET", "PUT"].includes(request.method)) {
      throw new Error("WebDAV 请求不受支持");
    }
    const url = new URL(request.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("WebDAV 地址必须使用 HTTP 或 HTTPS");
    const headers = request.headers;
    if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.entries(headers).some(([key, value]) => typeof key !== "string" || typeof value !== "string")) {
      throw new Error("WebDAV 请求头无效");
    }
    if (request.body !== undefined && typeof request.body !== "string") throw new Error("WebDAV 请求内容无效");
    const response = await net.fetch(url.href, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });
    return { status: response.status, body: await response.text() };
  });

  protocol.handle("iledger", (request) => {
    const filePath = localFileFor(request.url);
    return filePath
      ? net.fetch(pathToFileURL(filePath).toString())
      : new Response("Not found", { status: 404 });
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isAudio = permission === "media" && details.mediaTypes?.includes("audio");
    callback(Boolean(isAudio && webContents.getURL().startsWith(`${appOrigin}/`)));
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
