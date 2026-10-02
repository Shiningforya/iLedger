import assert from "node:assert/strict";
import { clearWebDavLogin, downloadLedgerFromWebDav, loadSavedWebDavLogin, saveWebDavLogin, testWebDav, uploadLedgerToWebDav } from "../.test-build/webdav.js";

const config = {
  provider: "custom",
  endpoint: "https://nas.example.test/dav/",
  username: "yoyo",
  password: "app-password",
  remotePath: "iLedger/ledger.json",
};

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  if (init.method === "GET") return new Response(JSON.stringify({ transactions: [], accounts: [], categories: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  return new Response("", { status: init.method === "PROPFIND" ? 207 : 201 });
};

await testWebDav(config);
assert.equal(calls[0].url, "https://nas.example.test/dav/");
assert.equal(calls[0].init.method, "PROPFIND");
assert.match(calls[0].init.headers.Authorization, /^Basic /);

await uploadLedgerToWebDav(config, { transactions: [], accounts: [], categories: [], webDav: config });
assert.equal(calls[1].init.method, "MKCOL");
assert.equal(calls[1].url, "https://nas.example.test/dav/iLedger/");
assert.equal(calls[2].init.method, "PUT");
assert.equal(calls[2].url, "https://nas.example.test/dav/iLedger/ledger.json");
assert.equal(JSON.parse(calls[2].init.body).webDav.username, "");

const downloaded = await downloadLedgerFromWebDav(config);
assert.deepEqual(downloaded.transactions, []);

const nativeCalls = [];
let nativeLogin = null;
globalThis.window = {
  iLedgerNative: {
    webDavRequest: async (request) => {
      nativeCalls.push(request);
      return { status: 207, body: "" };
    },
    loadWebDavLogin: async () => nativeLogin,
    saveWebDavLogin: async (login) => { nativeLogin = login; },
    clearWebDavLogin: async () => { nativeLogin = null; },
  },
};
await testWebDav(config);
assert.equal(nativeCalls.length, 1);
assert.equal(nativeCalls[0].method, "PROPFIND");
assert.equal(calls.length, 4, "desktop requests must not use renderer fetch");

globalThis.window.iLedgerNative.webDavRequest = async () => { throw new TypeError("connection refused"); };
await assert.rejects(testWebDav(config), /connection refused/);
const login = { provider: config.provider, endpoint: config.endpoint, username: config.username, password: config.password };
await saveWebDavLogin(login);
assert.deepEqual(await loadSavedWebDavLogin(), login);
await clearWebDavLogin();
assert.equal(await loadSavedWebDavLogin(), null);
delete globalThis.window;

const browserStorage = new Map();
globalThis.sessionStorage = {
  getItem: (key) => browserStorage.get(key) ?? null,
  setItem: (key, value) => browserStorage.set(key, value),
  removeItem: (key) => browserStorage.delete(key),
};
await saveWebDavLogin(login);
assert.deepEqual(await loadSavedWebDavLogin(), login);
await clearWebDavLogin();
assert.equal(await loadSavedWebDavLogin(), null);
delete globalThis.sessionStorage;

console.log("webdav regression tests: 11 passed");
