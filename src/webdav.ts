import { Capacitor, registerPlugin } from "@capacitor/core";
import type { LedgerState, WebDavSettings } from "./types";

type NativeRequest = { url: string; method: string; headers: Record<string, string>; body?: string };
type NativeResponse = { status: number; body: string };
export type SavedWebDavLogin = Pick<WebDavCredentials, "provider" | "endpoint" | "username" | "password">;
type AndroidWebDavPlugin = {
  request: (request: NativeRequest) => Promise<NativeResponse>;
  loadCredentials: () => Promise<{ credentials?: SavedWebDavLogin }>;
  saveCredentials: (credentials: SavedWebDavLogin) => Promise<void>;
  clearCredentials: () => Promise<void>;
};

declare global {
  interface Window {
    iLedgerNative?: {
      webDavRequest: (request: NativeRequest) => Promise<NativeResponse>;
      loadWebDavLogin: () => Promise<SavedWebDavLogin | null>;
      saveWebDavLogin: (credentials: SavedWebDavLogin) => Promise<void>;
      clearWebDavLogin: () => Promise<void>;
    };
  }
}

const androidWebDav = registerPlugin<AndroidWebDavPlugin>("LedgerWebDav");
const browserLoginKey = "iledger-webdav-browser-login";
const validLogin = (value: unknown): value is SavedWebDavLogin => {
  if (!value || typeof value !== "object") return false;
  const login = value as Partial<SavedWebDavLogin>;
  return (login.provider === "jianguoyun" || login.provider === "custom")
    && typeof login.endpoint === "string" && typeof login.username === "string"
    && typeof login.password === "string" && login.password.length > 0;
};

export async function loadSavedWebDavLogin(): Promise<SavedWebDavLogin | null> {
  if (typeof window !== "undefined" && window.iLedgerNative) {
    const login = await window.iLedgerNative.loadWebDavLogin();
    return validLogin(login) ? login : null;
  }
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    const login = (await androidWebDav.loadCredentials()).credentials;
    return validLogin(login) ? login : null;
  }
  try {
    const raw = sessionStorage.getItem(browserLoginKey);
    const login: unknown = raw ? JSON.parse(raw) : null;
    return validLogin(login) ? login : null;
  } catch { return null; }
}

export async function saveWebDavLogin(credentials: SavedWebDavLogin): Promise<void> {
  if (typeof window !== "undefined" && window.iLedgerNative) return window.iLedgerNative.saveWebDavLogin(credentials);
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") return androidWebDav.saveCredentials(credentials);
  sessionStorage.setItem(browserLoginKey, JSON.stringify(credentials));
}

export async function clearWebDavLogin(): Promise<void> {
  if (typeof window !== "undefined" && window.iLedgerNative) return window.iLedgerNative.clearWebDavLogin();
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") return androidWebDav.clearCredentials();
  sessionStorage.removeItem(browserLoginKey);
}

function nativeRequest() {
  if (typeof window !== "undefined" && window.iLedgerNative) return window.iLedgerNative.webDavRequest;
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") return androidWebDav.request;
  return null;
}

export interface WebDavCredentials extends WebDavSettings {
  password: string;
}

function authorization(username: string, password: string) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `Basic ${btoa(binary)}`;
}

function validate(config: WebDavCredentials) {
  if (!config.endpoint.trim()) throw new Error("请填写 WebDAV 服务器地址");
  if (!config.username.trim()) throw new Error("请填写 WebDAV 用户名");
  if (!config.password) throw new Error("请填写 WebDAV 应用密码");
  const endpoint = new URL(config.endpoint.trim());
  if (!/^https?:$/.test(endpoint.protocol)) throw new Error("WebDAV 地址必须使用 HTTP 或 HTTPS");
  return endpoint.href.endsWith("/") ? endpoint.href : `${endpoint.href}/`;
}

function remoteUrl(config: WebDavCredentials, path = config.remotePath) {
  return new URL(path.replace(/^\/+/, ""), validate(config)).href;
}

function requestError(error: unknown, config: WebDavCredentials, native: boolean) {
  if (error instanceof TypeError && !native) {
    const provider = config.provider === "jianguoyun" ? "坚果云" : "该服务器";
    return new Error(`${provider}拒绝了网页跨域请求；请在桌面或手机应用中连接，或检查服务器的跨域设置。`);
  }
  return error instanceof Error ? error : new Error("WebDAV 请求失败");
}

async function request(config: WebDavCredentials, path: string, init: RequestInit) {
  const transport = nativeRequest();
  const headers = {
    Authorization: authorization(config.username.trim(), config.password),
    ...Object.fromEntries(new Headers(init.headers).entries()),
  };
  try {
    const url = remoteUrl(config, path);
    if (transport) {
      const response = await transport({ url, method: init.method ?? "GET", headers, body: typeof init.body === "string" ? init.body : undefined });
      return new Response(response.status === 204 || response.status === 205 ? null : response.body, { status: response.status });
    }
    return await fetch(url, { ...init, headers });
  } catch (error) {
    throw requestError(error, config, Boolean(transport));
  }
}

function statusError(response: Response) {
  if (response.status === 401 || response.status === 403) return new Error("账号或应用密码不正确，或服务器拒绝访问");
  if (response.status === 404) return new Error("远程路径不存在");
  return new Error(`WebDAV 请求失败（${response.status}）`);
}

export async function testWebDav(config: WebDavCredentials) {
  const response = await request(config, "", {
    method: "PROPFIND",
    headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
    body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>',
  });
  if (!response.ok && response.status !== 207) throw statusError(response);
}

async function ensureRemoteFolder(config: WebDavCredentials) {
  const parts = config.remotePath.replace(/^\/+|\/+$/g, "").split("/").slice(0, -1);
  let path = "";
  for (const part of parts) {
    path += `${part}/`;
    const response = await request(config, path, { method: "MKCOL" });
    if (!response.ok && ![301, 405].includes(response.status)) throw statusError(response);
  }
}

export async function uploadLedgerToWebDav(config: WebDavCredentials, ledger: LedgerState) {
  await ensureRemoteFolder(config);
  const response = await request(config, config.remotePath, {
    method: "PUT",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ ...ledger, webDav: { ...ledger.webDav, username: "", lastSyncAt: undefined } }, null, 2),
  });
  if (!response.ok) throw statusError(response);
}

export async function downloadLedgerFromWebDav(config: WebDavCredentials) {
  const response = await request(config, config.remotePath, { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) throw statusError(response);
  const value = await response.json() as Partial<LedgerState>;
  if (!Array.isArray(value.transactions) || !Array.isArray(value.accounts) || !Array.isArray(value.categories)) {
    throw new Error("远程文件不是有效的 iLedger 账本");
  }
  return value;
}
