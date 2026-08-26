"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const node_path = require("node:path");
const node_fs = require("node:fs");
const node_crypto = require("node:crypto");
const promises = require("node:fs/promises");
const node_stream = require("node:stream");
const promises$1 = require("node:stream/promises");
const AdmZip = require("adm-zip");
const node_child_process = require("node:child_process");
const node_util = require("node:util");
const node_os = require("node:os");
const node_net = require("node:net");
const node_zlib = require("node:zlib");
const root = node_path.join(electron.app.getPath("appData"), "Brick Launcher", "data");
const paths = {
  root,
  /** Shared vanilla asset/library/version store, mirrors the .minecraft layout. */
  shared: node_path.join(root, "shared"),
  versions: node_path.join(root, "shared", "versions"),
  libraries: node_path.join(root, "shared", "libraries"),
  assets: node_path.join(root, "shared", "assets"),
  natives: node_path.join(root, "shared", "natives"),
  /** One folder per instance; this is the game directory Minecraft sees. */
  instances: node_path.join(root, "instances"),
  java: node_path.join(root, "java"),
  skins: node_path.join(root, "skins"),
  cache: node_path.join(root, "cache"),
  logs: node_path.join(root, "logs")
};
function instanceDir(id) {
  return node_path.join(paths.instances, id);
}
function ensureDirs() {
  for (const dir of Object.values(paths)) node_fs.mkdirSync(dir, { recursive: true });
}
function mavenToPath(coord) {
  const [group, artifact, versionAndClassifier, ...rest] = coord.split(":");
  let version = versionAndClassifier;
  let classifier = rest[0];
  let ext = "jar";
  const at = (classifier ?? version).lastIndexOf("@");
  if (at !== -1) {
    if (classifier) {
      ext = classifier.slice(at + 1);
      classifier = classifier.slice(0, at);
    } else {
      ext = version.slice(at + 1);
      version = version.slice(0, at);
    }
  }
  const file = classifier ? `${artifact}-${version}-${classifier}.${ext}` : `${artifact}-${version}.${ext}`;
  return node_path.join(...group.split("."), artifact, version, file);
}
function defaults() {
  return {
    settings: {
      gameDir: paths.instances,
      defaultMemoryMb: 4096,
      javaPath: "",
      jvmArgs: "-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M",
      msClientId: "",
      // Ships with a working key so CurseForge browsing needs no setup. Users
      // can replace it with their own in Settings → Integrations.
      curseforgeApiKey: "$2a$10$MhYNlP.E55kvistq8UCbrupVXy0SB2MXWhJevk8noDTxRv/PRvW9G",
      closeLauncherOnLaunch: false,
      showSnapshots: false,
      concurrentDownloads: 16,
      accentColor: "#1bd96a",
      animationsEnabled: true
    },
    accounts: [],
    activeAccountId: null,
    instances: [],
    skins: []
  };
}
class Store {
  file = node_path.join(paths.root, "config.json");
  data = defaults();
  load() {
    node_fs.mkdirSync(node_path.dirname(this.file), { recursive: true });
    if (!node_fs.existsSync(this.file)) {
      this.persist();
      return;
    }
    try {
      const parsed = JSON.parse(node_fs.readFileSync(this.file, "utf8"));
      const base = defaults();
      this.data = {
        ...base,
        ...parsed,
        // Merge settings key-by-key so new options added in an update appear
        // with their default instead of being undefined.
        settings: { ...base.settings, ...parsed.settings ?? {} }
      };
    } catch {
      this.data = defaults();
    }
  }
  persist() {
    const tmp = `${this.file}.tmp`;
    node_fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    node_fs.renameSync(tmp, this.file);
  }
  get(key) {
    return this.data[key];
  }
  set(key, value) {
    this.data[key] = value;
    this.persist();
  }
  patchSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.persist();
    return this.data.settings;
  }
}
const store = new Store();
const USER_AGENT = "BrickLauncher/1.0.0 (github.com/brick/launcher)";
async function sha1OfFile(path) {
  const hash = node_crypto.createHash("sha1");
  hash.update(await promises.readFile(path));
  return hash.digest("hex");
}
async function isSatisfied(job) {
  try {
    const info = await promises.stat(job.dest);
    if (!info.isFile()) return false;
    if (job.sha1) return await sha1OfFile(job.dest) === job.sha1.toLowerCase();
    if (job.size !== void 0) return info.size === job.size;
    return info.size > 0;
  } catch {
    return false;
  }
}
async function fetchWithRetry(url, init = {}, retries = 4) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, ...init.headers ?? {} }
      });
      if (!res.ok && res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      await new Promise((r) => setTimeout(r, 350 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
async function getJson(url, init = {}) {
  const res = await fetchWithRetry(url, init);
  return await res.json();
}
async function getText(url, init = {}) {
  const res = await fetchWithRetry(url, init);
  return await res.text();
}
async function getJsonCached(url, ttlMs, init = {}) {
  const key = node_crypto.createHash("sha1").update(url).digest("hex");
  const file = node_path.join(paths.cache, `${key}.json`);
  try {
    const info = await promises.stat(file);
    if (Date.now() - info.mtimeMs < ttlMs) {
      return JSON.parse(await promises.readFile(file, "utf8"));
    }
  } catch {
  }
  const data = await getJson(url, init);
  await promises.mkdir(paths.cache, { recursive: true });
  await promises.writeFile(file, JSON.stringify(data));
  return data;
}
async function downloadFile(job) {
  if (await isSatisfied(job)) return;
  await promises.mkdir(node_path.dirname(job.dest), { recursive: true });
  const tmp = `${job.dest}.${node_crypto.randomUUID().slice(0, 8)}.part`;
  const res = await fetchWithRetry(job.url);
  if (!res.body) throw new Error(`Empty response body for ${job.url}`);
  await promises$1.pipeline(node_stream.Readable.fromWeb(res.body), node_fs.createWriteStream(tmp));
  if (job.sha1) {
    const actual = await sha1OfFile(tmp);
    if (actual !== job.sha1.toLowerCase()) {
      await promises.unlink(tmp).catch(() => {
      });
      throw new Error(`Checksum mismatch for ${job.url}: expected ${job.sha1}, got ${actual}`);
    }
  }
  await promises.rename(tmp, job.dest);
}
async function downloadAll(rawJobs, concurrency, onProgress) {
  const byDest = /* @__PURE__ */ new Map();
  for (const job of rawJobs) {
    if (!byDest.has(job.dest)) byDest.set(job.dest, job);
  }
  const jobs = [...byDest.values()];
  const bytesTotal = jobs.reduce((sum, j) => sum + (j.size ?? 0), 0);
  let completed = 0;
  let bytesDone = 0;
  let cursor = 0;
  const errors = [];
  const worker = async () => {
    for (; ; ) {
      const index = cursor++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      try {
        await downloadFile(job);
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
      completed++;
      bytesDone += job.size ?? 0;
      onProgress?.({
        completed,
        total: jobs.length,
        bytesDone,
        bytesTotal,
        current: job.dest.split(/[\\/]/).pop() ?? ""
      });
    }
  };
  const pool = Math.max(1, Math.min(concurrency, jobs.length || 1));
  await Promise.all(Array.from({ length: pool }, worker));
  if (errors.length) {
    throw new Error(
      `${errors.length} download(s) failed. First error: ${errors[0].message}`
    );
  }
}
const REDIRECT_URI = "https://login.microsoftonline.com/common/oauth2/nativeclient";
const AUTHORIZE = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE = "https://api.minecraftservices.com/minecraft/profile";
const SCOPE = "XboxLive.signin offline_access";
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
class AuthError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
    this.name = "AuthError";
  }
}
function promptForCode(clientId, challenge) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      response_mode: "query",
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account"
    });
    const win = new electron.BrowserWindow({
      width: 520,
      height: 720,
      title: "Sign in with Microsoft",
      autoHideMenuBar: true,
      backgroundColor: "#16181c",
      webPreferences: { nodeIntegration: false, contextIsolation: true, partition: "ms-auth" }
    });
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      fn();
      if (!win.isDestroyed()) win.destroy();
    };
    const inspect = (rawUrl) => {
      if (!rawUrl.startsWith(REDIRECT_URI)) return;
      const url = new URL(rawUrl);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (code) finish(() => resolve(code));
      else if (error) {
        const description = url.searchParams.get("error_description") ?? error;
        finish(() => reject(new AuthError(`Microsoft rejected the sign-in: ${description}`)));
      }
    };
    win.webContents.on("will-redirect", (_e, url) => inspect(url));
    win.webContents.on("will-navigate", (_e, url) => inspect(url));
    win.on("closed", () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });
    win.loadURL(`${AUTHORIZE}?${params.toString()}`).catch((err) => finish(() => reject(err)));
  });
}
async function postForm(url, body) {
  return fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString()
  });
}
async function xboxToMinecraft(msAccessToken) {
  const xblRes = await fetchWithRetry(XBL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msAccessToken}`
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT"
    })
  });
  const xbl = await xblRes.json();
  const uhs = xbl.DisplayClaims.xui[0].uhs;
  const xstsRes = await fetch(XSTS, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Properties: { SandboxId: "RETAIL", UserTokens: [xbl.Token] },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT"
    })
  });
  if (!xstsRes.ok) {
    const body = await xstsRes.json().catch(() => ({}));
    const reasons = {
      2148916233: "This Microsoft account has no Xbox profile. Create one at xbox.com, then try again.",
      2148916235: "Xbox Live is not available in this account’s region.",
      2148916236: "This account needs adult verification before it can use Xbox Live.",
      2148916238: "This is a child account. Add it to a Microsoft Family group to sign in."
    };
    throw new AuthError(
      reasons[body.XErr ?? 0] ?? `Xbox Live authorisation failed (HTTP ${xstsRes.status}).`
    );
  }
  const xsts = await xstsRes.json();
  const mcRes = await fetchWithRetry(MC_LOGIN, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xsts.Token}` })
  });
  const mc = await mcRes.json();
  const profileRes = await fetch(MC_PROFILE, {
    headers: { Authorization: `Bearer ${mc.access_token}` }
  });
  if (profileRes.status === 404) {
    throw new AuthError(
      "This Microsoft account does not own Minecraft: Java Edition.",
      "Buy the game at minecraft.net, or use an Offline account for singleplayer and offline-mode servers."
    );
  }
  if (!profileRes.ok) {
    throw new AuthError(`Could not read the Minecraft profile (HTTP ${profileRes.status}).`);
  }
  const profile = await profileRes.json();
  return {
    token: mc.access_token,
    expiresAt: Date.now() + mc.expires_in * 1e3,
    uuid: profile.id,
    name: profile.name,
    skinUrl: profile.skins?.find((s) => s.state === "ACTIVE")?.url,
    capes: (profile.capes ?? []).map((c) => ({
      id: c.id,
      alias: c.alias,
      url: c.url,
      active: c.state === "ACTIVE"
    })),
    xuid: xsts.DisplayClaims.xui[0].xid
  };
}
async function signInWithMicrosoft(clientId) {
  if (!clientId) {
    throw new AuthError(
      "No Microsoft client ID is configured.",
      'Register a free Azure application, enable the "Mobile and desktop applications" platform, then paste its Application (client) ID into Settings → Accounts.'
    );
  }
  const verifier = base64url(node_crypto.randomBytes(32));
  const challenge = base64url(node_crypto.createHash("sha256").update(verifier).digest());
  const code = await promptForCode(clientId, challenge);
  if (code === null) return null;
  const tokenRes = await postForm(TOKEN, {
    client_id: clientId,
    scope: SCOPE,
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
    code_verifier: verifier
  });
  const tokens = await tokenRes.json();
  const session = await xboxToMinecraft(tokens.access_token);
  return {
    id: node_crypto.randomUUID(),
    kind: "microsoft",
    username: session.name,
    uuid: session.uuid,
    accessToken: session.token,
    refreshToken: tokens.refresh_token,
    expiresAt: session.expiresAt,
    xuid: session.xuid,
    skinUrl: session.skinUrl,
    capes: session.capes
  };
}
async function refreshAccount(account, clientId) {
  if (account.kind !== "microsoft") return account;
  if (account.expiresAt && account.expiresAt - 6e4 > Date.now()) return account;
  if (!account.refreshToken) {
    throw new AuthError(`Session for ${account.username} expired. Sign in again.`);
  }
  const res = await postForm(TOKEN, {
    client_id: clientId,
    scope: SCOPE,
    refresh_token: account.refreshToken,
    grant_type: "refresh_token"
  });
  const tokens = await res.json();
  const session = await xboxToMinecraft(tokens.access_token);
  return {
    ...account,
    username: session.name,
    uuid: session.uuid,
    accessToken: session.token,
    refreshToken: tokens.refresh_token ?? account.refreshToken,
    expiresAt: session.expiresAt,
    xuid: session.xuid,
    skinUrl: session.skinUrl,
    capes: session.capes
  };
}
function offlineUuid(username) {
  const hash = node_crypto.createHash("md5").update(`OfflinePlayer:${username}`).digest();
  hash[6] = hash[6] & 15 | 48;
  hash[8] = hash[8] & 63 | 128;
  return hash.toString("hex");
}
const NAME_RULE = /^[A-Za-z0-9_]{3,16}$/;
function createOfflineAccount(username) {
  const name = username.trim();
  if (!NAME_RULE.test(name)) {
    throw new Error("Username must be 3–16 characters, using only letters, numbers and underscore.");
  }
  const accounts = store.get("accounts");
  if (accounts.some((a) => a.kind === "offline" && a.username.toLowerCase() === name.toLowerCase())) {
    throw new Error(`An offline account named ${name} already exists.`);
  }
  return { id: node_crypto.randomUUID(), kind: "offline", username: name, uuid: offlineUuid(name) };
}
function listAccounts() {
  return store.get("accounts").map(({ accessToken, refreshToken, ...safe }) => safe);
}
function addAccount(account) {
  const accounts = store.get("accounts");
  const existing = accounts.findIndex((a) => a.uuid === account.uuid && a.kind === account.kind);
  if (existing >= 0) accounts[existing] = { ...accounts[existing], ...account };
  else accounts.push(account);
  store.set("accounts", accounts);
  if (!store.get("activeAccountId")) store.set("activeAccountId", account.id);
  return listAccounts();
}
function removeAccount(id) {
  const accounts = store.get("accounts").filter((a) => a.id !== id);
  store.set("accounts", accounts);
  if (store.get("activeAccountId") === id) {
    store.set("activeAccountId", accounts[0]?.id ?? null);
  }
  return listAccounts();
}
function setActiveAccount(id) {
  store.set("activeAccountId", id);
}
function getActiveAccountId() {
  return store.get("activeAccountId");
}
function getAccountRaw(id) {
  return store.get("accounts").find((a) => a.id === id);
}
async function signIn() {
  const account = await signInWithMicrosoft(store.get("settings").msClientId);
  if (!account) return null;
  addAccount(account);
  return { ...account, accessToken: void 0, refreshToken: void 0 };
}
async function ensureValidSession(id) {
  const account = getAccountRaw(id);
  if (!account) throw new Error("That account is no longer available. Pick another one.");
  if (account.kind === "offline") return account;
  const refreshed = await refreshAccount(account, store.get("settings").msClientId);
  if (refreshed.accessToken !== account.accessToken) {
    const accounts = store.get("accounts");
    const index = accounts.findIndex((a) => a.id === id);
    if (index >= 0) {
      accounts[index] = refreshed;
      store.set("accounts", accounts);
    }
  }
  return refreshed;
}
const MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
async function getVersionManifest() {
  return getJsonCached(MANIFEST_URL, 15 * 60 * 1e3);
}
async function listVersions$2(includeSnapshots) {
  const manifest = await getVersionManifest();
  return manifest.versions.filter((v) => includeSnapshots || v.type === "release").map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
}
function versionJsonPath(id) {
  return node_path.join(paths.versions, id, `${id}.json`);
}
async function fetchVanillaVersionJson(id) {
  const dest = versionJsonPath(id);
  if (node_fs.existsSync(dest)) {
    return JSON.parse(await promises.readFile(dest, "utf8"));
  }
  const manifest = await getVersionManifest();
  const entry = manifest.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`Unknown Minecraft version: ${id}`);
  const json = await getJson(entry.url);
  await promises.mkdir(node_path.join(paths.versions, id), { recursive: true });
  await promises.writeFile(dest, JSON.stringify(json, null, 2));
  return json;
}
async function readVersionJson(id) {
  const dest = versionJsonPath(id);
  if (node_fs.existsSync(dest)) return JSON.parse(await promises.readFile(dest, "utf8"));
  return fetchVanillaVersionJson(id);
}
async function writeVersionJson(id, json) {
  await promises.mkdir(node_path.join(paths.versions, id), { recursive: true });
  await promises.writeFile(versionJsonPath(id), JSON.stringify(json, null, 2));
}
async function resolveVersionChain(id) {
  const chain = [];
  let current = await readVersionJson(id);
  const seen = /* @__PURE__ */ new Set();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    chain.push(current);
    current = current.inheritsFrom ? await fetchVanillaVersionJson(current.inheritsFrom) : void 0;
  }
  const merged = chain.reduceRight((parent, child) => {
    if (!parent.id) return { ...child };
    return {
      ...parent,
      ...child,
      id: child.id,
      // Loader libraries must win over vanilla's when both provide a coordinate,
      // and must appear earlier on the classpath.
      libraries: [...child.libraries, ...parent.libraries],
      assetIndex: child.assetIndex ?? parent.assetIndex,
      assets: child.assets ?? parent.assets,
      downloads: { ...parent.downloads ?? {}, ...child.downloads ?? {} },
      javaVersion: child.javaVersion ?? parent.javaVersion,
      logging: child.logging ?? parent.logging,
      mainClass: child.mainClass ?? parent.mainClass,
      minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
      arguments: {
        game: [...parent.arguments?.game ?? [], ...child.arguments?.game ?? []],
        jvm: [...parent.arguments?.jvm ?? [], ...child.arguments?.jvm ?? []]
      }
    };
  }, {});
  const seenCoords = /* @__PURE__ */ new Set();
  merged.libraries = merged.libraries.filter((lib) => {
    const parts = lib.name.split(":");
    const key = `${parts[0]}:${parts[1]}:${parts[3] ?? ""}`;
    if (seenCoords.has(key)) return false;
    seenCoords.add(key);
    return true;
  });
  return merged;
}
async function fetchAssetIndex(version) {
  if (!version.assetIndex) return null;
  const dest = node_path.join(paths.assets, "indexes", `${version.assetIndex.id}.json`);
  await downloadFile({
    url: version.assetIndex.url,
    dest,
    sha1: version.assetIndex.sha1,
    size: version.assetIndex.size
  });
  return JSON.parse(await promises.readFile(dest, "utf8"));
}
const ENDPOINTS = {
  fabric: "https://meta.fabricmc.net/v2",
  quilt: "https://meta.quiltmc.org/v3"
};
async function listLoaderVersions(kind, mcVersion) {
  const entries = await getJsonCached(
    `${ENDPOINTS[kind]}/versions/loader/${encodeURIComponent(mcVersion)}`,
    10 * 60 * 1e3
  );
  return entries.map((e) => e.loader.version);
}
async function installFabricLike(kind, mcVersion, loaderVersion) {
  const url = `${ENDPOINTS[kind]}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const profile = await getJson(url);
  if (!profile.id) throw new Error(`${kind} returned a profile without an id`);
  await writeVersionJson(profile.id, profile);
  return profile.id;
}
const run$1 = node_util.promisify(node_child_process.execFile);
async function probeJava(javaPath) {
  try {
    const { stderr, stdout } = await run$1(javaPath, ["-XshowSettings:properties", "-version"], {
      timeout: 8e3
    });
    const text = `${stderr}
${stdout}`;
    const versionMatch = text.match(/java\.version\s*=\s*(\d+)(?:\.(\d+))?/) ?? text.match(/version "(\d+)(?:\.(\d+))?[^"]*"/);
    if (!versionMatch) return null;
    const major = versionMatch[1] === "1" ? Number(versionMatch[2]) : Number(versionMatch[1]);
    const homeMatch = text.match(/java\.home\s*=\s*(.+)/);
    const home = homeMatch ? homeMatch[1].trim() : javaPath;
    const vendorLine = text.split("\n").find((l) => /Runtime Environment/.test(l)) ?? "";
    return { path: javaPath, major, vendor: vendorLine.trim(), home, source: "system" };
  } catch {
    return null;
  }
}
function bundledJavaBin(major) {
  const home = node_path.join(paths.java, `jre-${major}`);
  return node_os.platform() === "win32" ? node_path.join(home, "bin", "java.exe") : node_path.join(home, "Contents", "Home", "bin", "java");
}
function candidateBinsFor(home) {
  return node_os.platform() === "win32" ? [node_path.join(home, "bin", "java.exe")] : [node_path.join(home, "Contents", "Home", "bin", "java"), node_path.join(home, "bin", "java")];
}
async function findSystemJava() {
  const found = [];
  if (process.env.JAVA_HOME) found.push(node_path.join(process.env.JAVA_HOME, "bin", "java"));
  if (node_os.platform() === "darwin") {
    try {
      const { stdout } = await run$1("/usr/libexec/java_home", ["-V"], { timeout: 8e3 });
      for (const line of stdout.split("\n")) {
        const m = line.match(/\s(\/.+?)$/);
        if (m) found.push(node_path.join(m[1].trim(), "bin", "java"));
      }
    } catch {
    }
    for (const base of ["/opt/homebrew/opt", "/usr/local/opt"]) {
      try {
        for (const entry of await promises.readdir(base)) {
          if (/^openjdk/.test(entry)) found.push(node_path.join(base, entry, "bin", "java"));
        }
      } catch {
      }
    }
  }
  if (node_os.platform() === "linux") {
    for (const base of ["/usr/lib/jvm"]) {
      try {
        for (const entry of await promises.readdir(base)) found.push(node_path.join(base, entry, "bin", "java"));
      } catch {
      }
    }
  }
  if (node_os.platform() === "win32") {
    for (const base of ["C:\\Program Files\\Java", "C:\\Program Files\\Eclipse Adoptium"]) {
      try {
        for (const entry of await promises.readdir(base)) found.push(node_path.join(base, entry, "bin", "java.exe"));
      } catch {
      }
    }
  }
  found.push(node_os.platform() === "win32" ? "java.exe" : "java");
  return [...new Set(found)];
}
async function detectJavaRuntimes() {
  const results = [];
  const seenHomes = /* @__PURE__ */ new Set();
  for (const major of [8, 17, 21]) {
    const bin = bundledJavaBin(major);
    if (!node_fs.existsSync(bin)) continue;
    const probed = await probeJava(bin);
    if (probed && !seenHomes.has(probed.home)) {
      seenHomes.add(probed.home);
      results.push({ ...probed, source: "bundled" });
    }
  }
  for (const candidate of await findSystemJava()) {
    if (!node_fs.existsSync(candidate) && !/^java(\.exe)?$/.test(candidate)) continue;
    const probed = await probeJava(candidate);
    if (!probed || seenHomes.has(probed.home)) continue;
    seenHomes.add(probed.home);
    results.push(probed);
  }
  return results.sort((a, b) => a.major - b.major);
}
function adoptiumOs() {
  switch (node_os.platform()) {
    case "darwin":
      return "mac";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
function adoptiumArch() {
  switch (node_os.arch()) {
    case "arm64":
      return "aarch64";
    case "x64":
      return "x64";
    default:
      return "x64";
  }
}
async function downloadJava(major, onProgress) {
  const bin = bundledJavaBin(major);
  if (node_fs.existsSync(bin)) return bin;
  onProgress(`Looking up Java ${major}`, 0.05);
  const url = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${adoptiumArch()}&image_type=jre&os=${adoptiumOs()}&vendor=eclipse`;
  const assets = await getJson(url);
  if (!assets.length) throw new Error(`No Temurin JRE ${major} build for ${adoptiumOs()}/${adoptiumArch()}`);
  const pkg = assets[0].binary.package;
  const home = node_path.join(paths.java, `jre-${major}`);
  const archive = node_path.join(paths.java, pkg.name);
  onProgress(`Downloading Java ${major} (${Math.round(pkg.size / 1048576)} MB)`, 0.2);
  await downloadFile({ url: pkg.link, dest: archive, size: pkg.size });
  onProgress(`Extracting Java ${major}`, 0.75);
  await promises.rm(home, { recursive: true, force: true });
  await promises.mkdir(home, { recursive: true });
  if (pkg.name.endsWith(".zip")) {
    const { default: AdmZip2 } = await import("adm-zip");
    new AdmZip2(archive).extractAllTo(home, true);
  } else {
    await run$1("tar", ["-xzf", archive, "-C", home, "--strip-components=1"]);
  }
  await promises.rm(archive, { force: true });
  for (const candidate of candidateBinsFor(home)) {
    if (node_fs.existsSync(candidate)) {
      await promises.chmod(candidate, 493).catch(() => {
      });
      onProgress(`Java ${major} ready`, 1);
      return candidate;
    }
  }
  throw new Error(`Extracted Java ${major} but found no java binary under ${home}`);
}
async function resolveJavaFor(requiredMajor, override, onProgress) {
  if (override) {
    const probed = await probeJava(override);
    if (probed) return override;
    throw new Error(`Configured Java path is not runnable: ${override}`);
  }
  const runtimes = await detectJavaRuntimes();
  const exact = runtimes.find((r) => r.major === requiredMajor);
  if (exact) return exact.path;
  if (requiredMajor >= 17) {
    const newer = runtimes.find((r) => r.major >= requiredMajor);
    if (newer) return newer.path;
  }
  return downloadJava(requiredMajor, onProgress);
}
const run = node_util.promisify(node_child_process.execFile);
const FORGE_MAVEN = "https://maven.minecraftforge.net";
const NEO_MAVEN = "https://maven.neoforged.net/releases";
function parseMavenVersions(xml) {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]).reverse();
}
async function listForgeVersions(kind, mcVersion) {
  if (kind === "forge") {
    const xml2 = await getText(`${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`);
    return parseMavenVersions(xml2).filter((v) => v.startsWith(`${mcVersion}-`)).map((v) => v.slice(mcVersion.length + 1));
  }
  const xml = await getText(`${NEO_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`);
  const parts = mcVersion.split(".");
  if (parts[0] !== "1" || parts.length < 2) return [];
  const prefix = `${parts[1]}.${parts[2] ?? "0"}.`;
  return parseMavenVersions(xml).filter((v) => v.startsWith(prefix));
}
function installerCoordinate(kind, mcVersion, loaderVersion) {
  if (kind === "forge") {
    const full = `${mcVersion}-${loaderVersion}`;
    return {
      url: `${FORGE_MAVEN}/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`,
      fileName: `forge-${full}-installer.jar`
    };
  }
  return {
    url: `${NEO_MAVEN}/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`,
    fileName: `neoforge-${loaderVersion}-installer.jar`
  };
}
function libDest(path) {
  return node_path.join(paths.libraries, ...path.split("/"));
}
async function sha1File(path) {
  return node_crypto.createHash("sha1").update(await promises.readFile(path)).digest("hex");
}
function resolveMavenToken(token) {
  return node_path.join(paths.libraries, mavenToPath(token.slice(1, -1)));
}
async function resolveDataValue(value, zip, workDir) {
  if (value.startsWith("[") && value.endsWith("]")) return resolveMavenToken(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith("/")) {
    const entry = zip.getEntry(value.slice(1));
    if (!entry) throw new Error(`Installer is missing embedded file ${value}`);
    const dest = node_path.join(workDir, value.slice(1));
    await promises.mkdir(node_path.dirname(dest), { recursive: true });
    await promises.writeFile(dest, entry.getData());
    return dest;
  }
  return value;
}
function mainClassOf(jarPath) {
  const manifest = new AdmZip(jarPath).getEntry("META-INF/MANIFEST.MF");
  if (!manifest) throw new Error(`No manifest in ${jarPath}`);
  const text = manifest.getData().toString("utf8").replace(/\r\n /g, "");
  const match = text.match(/Main-Class:\s*(\S+)/);
  if (!match) throw new Error(`No Main-Class in ${jarPath}`);
  return match[1];
}
async function outputsSatisfied(spec, vars) {
  if (!spec.outputs || Object.keys(spec.outputs).length === 0) return false;
  for (const [rawPath, rawHash] of Object.entries(spec.outputs)) {
    const path = applyTokens(rawPath, vars);
    const expected = applyTokens(rawHash, vars).replace(/'/g, "");
    if (!node_fs.existsSync(path)) return false;
    if (expected && await sha1File(path) !== expected) return false;
  }
  return true;
}
function applyTokens(input, vars) {
  let out = input.replace(/\{(\w+)\}/g, (whole, key) => vars[key] ?? whole);
  if (out.startsWith("[") && out.endsWith("]")) out = resolveMavenToken(out);
  return out;
}
async function installForgeLike(kind, mcVersion, loaderVersion, concurrency, onProgress) {
  const { url, fileName } = installerCoordinate(kind, mcVersion, loaderVersion);
  const workDir = node_path.join(paths.cache, `${kind}-${mcVersion}-${loaderVersion}`);
  const installerPath = node_path.join(workDir, fileName);
  onProgress({ stage: "Downloading installer", detail: fileName, progress: 0.05 });
  await promises.mkdir(workDir, { recursive: true });
  await downloadFile({ url, dest: installerPath });
  const zip = new AdmZip(installerPath);
  const profileEntry = zip.getEntry("install_profile.json");
  if (!profileEntry) throw new Error(`${fileName} has no install_profile.json`);
  const profile = JSON.parse(profileEntry.getData().toString("utf8"));
  if (!profile.processors?.length && profile.versionInfo) {
    onProgress({ stage: "Installing (legacy)", detail: profile.versionInfo.id, progress: 0.4 });
    const versionJson2 = profile.versionInfo;
    await writeVersionJson(versionJson2.id, versionJson2);
    const embedded = profile.install?.filePath;
    if (embedded && profile.install?.path) {
      const entry = zip.getEntry(embedded);
      if (entry) {
        const dest = node_path.join(paths.libraries, mavenToPath(profile.install.path));
        await promises.mkdir(node_path.dirname(dest), { recursive: true });
        await promises.writeFile(dest, entry.getData());
      }
    }
    onProgress({ stage: "Ready", detail: versionJson2.id, progress: 1 });
    return versionJson2.id;
  }
  const versionEntry = zip.getEntry(profile.json?.replace(/^\//, "") ?? "version.json");
  if (!versionEntry) throw new Error(`${fileName} has no version json`);
  const versionJson = JSON.parse(versionEntry.getData().toString("utf8"));
  await writeVersionJson(versionJson.id, versionJson);
  const vanilla = await fetchVanillaVersionJson(mcVersion);
  const clientJar = node_path.join(paths.versions, mcVersion, `${mcVersion}.jar`);
  if (vanilla.downloads?.client) {
    await downloadFile({
      url: vanilla.downloads.client.url,
      dest: clientJar,
      sha1: vanilla.downloads.client.sha1,
      size: vanilla.downloads.client.size
    });
  }
  onProgress({ stage: "Downloading loader libraries", detail: "", progress: 0.15 });
  const jobs = [];
  const embeddedLibs = [];
  for (const lib of [...profile.libraries ?? [], ...versionJson.libraries ?? []]) {
    const artifact = lib.downloads?.artifact;
    const path = artifact?.path ?? mavenToPath(lib.name);
    const dest = libDest(path.split(/[\\/]/).join("/"));
    if (artifact?.url) {
      jobs.push({ url: artifact.url, dest, sha1: artifact.sha1, size: artifact.size });
    } else {
      embeddedLibs.push({ path: dest, entry: `maven/${path}` });
    }
  }
  await downloadAll(jobs, concurrency, (p) => {
    onProgress({
      stage: "Downloading loader libraries",
      detail: `${p.completed}/${p.total} · ${p.current}`,
      progress: 0.15 + 0.35 * (p.completed / Math.max(1, p.total))
    });
  });
  for (const lib of embeddedLibs) {
    if (node_fs.existsSync(lib.path)) continue;
    const entry = zip.getEntry(lib.entry);
    if (!entry) continue;
    await promises.mkdir(node_path.dirname(lib.path), { recursive: true });
    await promises.writeFile(lib.path, entry.getData());
  }
  const vars = {
    MINECRAFT_JAR: clientJar,
    SIDE: "client",
    ROOT: workDir,
    INSTALLER: installerPath,
    LIBRARY_DIR: paths.libraries
  };
  for (const [key, entry] of Object.entries(profile.data ?? {})) {
    vars[key] = await resolveDataValue(entry.client, zip, workDir);
  }
  const processors = (profile.processors ?? []).filter(
    (p) => !p.sides || p.sides.includes("client")
  );
  if (processors.length) {
    onProgress({ stage: "Preparing Java for patching", detail: "", progress: 0.52 });
    const javaPath = await resolveJavaFor(
      versionJson.javaVersion?.majorVersion ?? vanilla.javaVersion?.majorVersion ?? 8,
      void 0,
      (detail, progress) => onProgress({ stage: "Preparing Java", detail, progress: 0.52 + progress * 0.05 })
    );
    for (const [index, spec] of processors.entries()) {
      const label = spec.jar.split(":")[1] ?? spec.jar;
      const share = 0.4 / processors.length;
      const base = 0.57 + index * share;
      onProgress({
        stage: "Patching Minecraft",
        detail: `${index + 1}/${processors.length} · ${label}`,
        progress: base
      });
      if (await outputsSatisfied(spec, vars)) continue;
      const jarPath = resolveMavenToken(`[${spec.jar}]`);
      if (!node_fs.existsSync(jarPath)) throw new Error(`Processor jar missing: ${spec.jar}`);
      const classpath = [...spec.classpath.map((c) => resolveMavenToken(`[${c}]`)), jarPath];
      const args = spec.args.map((arg) => applyTokens(arg, vars));
      try {
        await run(javaPath, ["-cp", classpath.join(node_path.delimiter), mainClassOf(jarPath), ...args], {
          cwd: workDir,
          maxBuffer: 1024 * 1024 * 64,
          timeout: 10 * 60 * 1e3
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`${kind} processor "${label}" failed: ${detail}`);
      }
    }
  }
  await promises.rm(node_path.join(workDir, "data"), { recursive: true, force: true });
  onProgress({ stage: "Ready", detail: versionJson.id, progress: 1 });
  return versionJson.id;
}
async function listLoaderBuilds(loader, mcVersion) {
  switch (loader) {
    case "vanilla":
      return [];
    case "fabric":
      return listLoaderVersions("fabric", mcVersion);
    case "quilt":
      return listLoaderVersions("quilt", mcVersion);
    case "forge":
      return listForgeVersions("forge", mcVersion);
    case "neoforge":
      return listForgeVersions("neoforge", mcVersion);
  }
}
async function installLoader(loader, mcVersion, loaderVersion, concurrency, onProgress) {
  if (loader === "vanilla") {
    await fetchVanillaVersionJson(mcVersion);
    return { versionId: mcVersion };
  }
  let resolved = loaderVersion;
  if (!resolved) {
    const builds = await listLoaderBuilds(loader, mcVersion);
    if (!builds.length) {
      throw new Error(`${loader} has no build for Minecraft ${mcVersion} yet.`);
    }
    resolved = builds[0];
  }
  if (loader === "fabric" || loader === "quilt") {
    onProgress({ stage: `Installing ${loader}`, detail: resolved, progress: 0.3 });
    const versionId2 = await installFabricLike(loader, mcVersion, resolved);
    onProgress({ stage: "Ready", detail: versionId2, progress: 1 });
    return { versionId: versionId2, loaderVersion: resolved };
  }
  const versionId = await installForgeLike(loader, mcVersion, resolved, concurrency, onProgress);
  return { versionId, loaderVersion: resolved };
}
function currentOs() {
  switch (node_os.platform()) {
    case "win32":
      return "windows";
    case "darwin":
      return "osx";
    default:
      return "linux";
  }
}
function currentArch() {
  switch (node_os.arch()) {
    case "x64":
      return "x86_64";
    case "ia32":
      return "x86";
    case "arm64":
      return "arm64";
    default:
      return node_os.arch();
  }
}
function rulesAllow(rules, features = {}) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (!ruleMatches(rule, features)) continue;
    allowed = rule.action === "allow";
  }
  return allowed;
}
function ruleMatches(rule, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== currentOs()) return false;
    if (rule.os.arch && rule.os.arch !== currentArch() && rule.os.arch !== node_os.arch()) return false;
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(node_os.release())) return false;
      } catch {
      }
    }
  }
  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      if ((features[key] ?? false) !== expected) return false;
    }
  }
  return true;
}
function libraryApplies(lib, features = {}) {
  return rulesAllow(lib.rules, features);
}
function nativeClassifier(lib) {
  if (!lib.natives) return null;
  const template = lib.natives[currentOs()];
  if (!template) return null;
  return template.replace("${arch}", node_os.arch() === "ia32" ? "32" : "64");
}
const RESOURCES = "https://resources.download.minecraft.net";
const MAVEN_FALLBACK = "https://libraries.minecraft.net/";
function libraryJarPath(lib) {
  const artifactPath = lib.downloads?.artifact?.path ?? mavenToPath(lib.name);
  return node_path.join(paths.libraries, artifactPath);
}
function nativeJarPath(lib, classifier) {
  const entry = lib.downloads?.classifiers?.[classifier];
  const path = entry?.path ?? mavenToPath(`${lib.name}:${classifier}`);
  return node_path.join(paths.libraries, path);
}
function libraryJobs(lib) {
  const jobs = [];
  const artifact = lib.downloads?.artifact;
  if (artifact?.url) {
    jobs.push({
      url: artifact.url,
      dest: node_path.join(paths.libraries, artifact.path),
      sha1: artifact.sha1,
      size: artifact.size
    });
  } else if (!lib.natives) {
    const relative = mavenToPath(lib.name).split(/[\\/]/).join("/");
    const base = lib.url ?? MAVEN_FALLBACK;
    jobs.push({
      url: `${base.endsWith("/") ? base : `${base}/`}${relative}`,
      dest: node_path.join(paths.libraries, mavenToPath(lib.name))
    });
  }
  const classifier = nativeClassifier(lib);
  if (classifier) {
    const entry = lib.downloads?.classifiers?.[classifier];
    if (entry) {
      jobs.push({
        url: entry.url,
        dest: node_path.join(paths.libraries, entry.path),
        sha1: entry.sha1,
        size: entry.size
      });
    }
  }
  return jobs;
}
async function extractNatives(version, nativesDir) {
  await promises.mkdir(nativesDir, { recursive: true });
  const existing = await promises.readdir(nativesDir).catch(() => []);
  for (const lib of version.libraries) {
    if (!libraryApplies(lib)) continue;
    const classifier = nativeClassifier(lib);
    if (!classifier) continue;
    const jar = nativeJarPath(lib, classifier);
    if (!jar || !node_fs.existsSync(jar)) continue;
    const zip = new AdmZip(jar);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const name = entry.entryName;
      if (name.startsWith("META-INF/")) continue;
      if (lib.extract?.exclude?.some((prefix) => name.startsWith(prefix))) continue;
      const base = name.split("/").pop();
      if (existing.includes(base)) continue;
      await promises.writeFile(node_path.join(nativesDir, base), entry.getData());
    }
  }
}
function nativesDirFor(versionId) {
  return node_path.join(paths.natives, `${versionId}-${currentOs()}`);
}
async function installVersion(versionId, concurrency, onProgress) {
  onProgress({ stage: "Resolving version", detail: versionId, progress: 0.02 });
  const version = await resolveVersionChain(versionId);
  const jobs = [];
  const client = version.downloads?.client;
  if (client) {
    jobs.push({
      url: client.url,
      dest: node_path.join(paths.versions, version.id, `${version.id}.jar`),
      sha1: client.sha1,
      size: client.size
    });
  }
  for (const lib of version.libraries) {
    if (!libraryApplies(lib)) continue;
    jobs.push(...libraryJobs(lib));
  }
  if (version.logging?.client?.file) {
    const log = version.logging.client.file;
    jobs.push({
      url: log.url,
      dest: node_path.join(paths.assets, "log_configs", log.id),
      sha1: log.sha1,
      size: log.size
    });
  }
  onProgress({ stage: "Downloading libraries", detail: `${jobs.length} files`, progress: 0.05 });
  await downloadAll(jobs, concurrency, (p) => {
    onProgress({
      stage: "Downloading libraries",
      detail: `${p.completed}/${p.total} · ${p.current}`,
      // Libraries occupy 5%..45% of the bar; assets take the rest.
      progress: 0.05 + 0.4 * (p.completed / Math.max(1, p.total))
    });
  });
  onProgress({ stage: "Reading asset index", detail: version.assetIndex?.id ?? "", progress: 0.46 });
  const index = await fetchAssetIndex(version);
  if (index) {
    const objects = Object.entries(index.objects);
    const assetJobs = objects.map(([, obj]) => ({
      url: `${RESOURCES}/${obj.hash.slice(0, 2)}/${obj.hash}`,
      dest: node_path.join(paths.assets, "objects", obj.hash.slice(0, 2), obj.hash),
      sha1: obj.hash,
      size: obj.size
    }));
    onProgress({ stage: "Downloading assets", detail: `${assetJobs.length} files`, progress: 0.47 });
    await downloadAll(assetJobs, concurrency, (p) => {
      onProgress({
        stage: "Downloading assets",
        detail: `${p.completed}/${p.total}`,
        progress: 0.47 + 0.5 * (p.completed / Math.max(1, p.total))
      });
    });
    if (index.virtual || index.map_to_resources) {
      const virtualRoot = node_path.join(paths.assets, "virtual", version.assetIndex.id);
      for (const [name, obj] of objects) {
        const dest = node_path.join(virtualRoot, ...name.split("/"));
        if (node_fs.existsSync(dest)) continue;
        await promises.mkdir(node_path.join(dest, ".."), { recursive: true });
        await downloadFile({
          url: `${RESOURCES}/${obj.hash.slice(0, 2)}/${obj.hash}`,
          dest,
          sha1: obj.hash
        });
      }
    }
  }
  onProgress({ stage: "Extracting natives", detail: "", progress: 0.98 });
  await extractNatives(version, nativesDirFor(version.id));
  onProgress({ stage: "Ready", detail: version.id, progress: 1 });
  return version;
}
function listInstances() {
  return store.get("instances");
}
function getInstance(id) {
  return store.get("instances").find((i) => i.id === id);
}
function save$1(instances) {
  store.set("instances", instances);
  return instances;
}
function updateInstance(id, patch) {
  const instances = store.get("instances");
  const index = instances.findIndex((i) => i.id === id);
  if (index < 0) throw new Error("Instance not found");
  instances[index] = { ...instances[index], ...patch, id };
  return save$1(instances);
}
async function createInstanceRecord(args) {
  const settings = store.get("settings");
  const instance = {
    id: node_crypto.randomUUID(),
    name: args.name.trim() || `${args.loader} ${args.mcVersion}`,
    mcVersion: args.mcVersion,
    loader: args.loader,
    loaderVersion: args.loaderVersion,
    versionId: args.mcVersion,
    icon: args.icon,
    createdAt: Date.now(),
    totalPlaySeconds: 0,
    memoryMb: args.memoryMb ?? settings.defaultMemoryMb,
    installed: false,
    group: args.group
  };
  save$1([...store.get("instances"), instance]);
  const dir = instanceDir(instance.id);
  for (const sub of ["mods", "shaderpacks", "resourcepacks", "saves", "config", ".brick"]) {
    await promises.mkdir(node_path.join(dir, sub), { recursive: true });
  }
  return instance;
}
async function createInstance(args, onProgress) {
  const settings = store.get("settings");
  const id = node_crypto.randomUUID();
  const instance = {
    id,
    name: args.name.trim() || `${args.loader} ${args.mcVersion}`,
    mcVersion: args.mcVersion,
    loader: args.loader,
    loaderVersion: args.loaderVersion,
    versionId: args.mcVersion,
    icon: args.icon,
    createdAt: Date.now(),
    totalPlaySeconds: 0,
    memoryMb: args.memoryMb ?? settings.defaultMemoryMb,
    installed: false,
    group: args.group
  };
  save$1([...store.get("instances"), instance]);
  const dir = instanceDir(id);
  for (const sub of ["mods", "shaderpacks", "resourcepacks", "saves", "config", ".brick"]) {
    await promises.mkdir(node_path.join(dir, sub), { recursive: true });
  }
  try {
    onProgress("Installing loader", args.loader, 0.05);
    const { versionId, loaderVersion } = await installLoader(
      args.loader,
      args.mcVersion,
      args.loaderVersion,
      settings.concurrentDownloads,
      (p) => onProgress(p.stage, p.detail, 0.05 + p.progress * 0.35)
    );
    updateInstance(id, { versionId, loaderVersion });
    await installVersion(
      versionId,
      settings.concurrentDownloads,
      (p) => onProgress(p.stage, p.detail, 0.4 + p.progress * 0.6)
    );
    updateInstance(id, { installed: true });
    onProgress("Ready to play", instance.name, 1);
  } catch (err) {
    updateInstance(id, { installed: false });
    throw err;
  }
  return getInstance(id);
}
async function deleteInstance(id) {
  await promises.rm(instanceDir(id), { recursive: true, force: true });
  return save$1(store.get("instances").filter((i) => i.id !== id));
}
async function duplicateInstance(id, newName) {
  const source = getInstance(id);
  if (!source) throw new Error("Instance not found");
  const copy = {
    ...source,
    id: node_crypto.randomUUID(),
    name: newName,
    createdAt: Date.now(),
    lastPlayed: void 0,
    totalPlaySeconds: 0
  };
  const { cp } = await import("node:fs/promises");
  await cp(instanceDir(source.id), instanceDir(copy.id), { recursive: true });
  return save$1([...store.get("instances"), copy]);
}
function recordPlaySession(id, seconds) {
  const instance = getInstance(id);
  if (!instance) return;
  updateInstance(id, {
    lastPlayed: Date.now(),
    totalPlaySeconds: instance.totalPlaySeconds + Math.max(0, Math.round(seconds))
  });
}
const SKIN_API = "https://api.minecraftservices.com/minecraft/profile/skins";
const CAPE_API = "https://api.minecraftservices.com/minecraft/profile/capes/active";
function listSkins() {
  return store.get("skins");
}
function assertPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error("Skins must be PNG images.");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const valid = width === 64 && (height === 64 || height === 32);
  if (!valid) {
    throw new Error(`Skin must be 64×64 (or legacy 64×32). This image is ${width}×${height}.`);
  }
}
async function addSkinFromFile(filePath, name, variant) {
  const buffer = await promises.readFile(filePath);
  assertPng(buffer);
  await promises.mkdir(paths.skins, { recursive: true });
  const id = node_crypto.randomUUID();
  const dest = node_path.join(paths.skins, `${id}.png`);
  await promises.copyFile(filePath, dest);
  const entry = {
    id,
    name: name.trim() || node_path.basename(filePath).replace(/\.png$/i, ""),
    path: dest,
    variant,
    addedAt: Date.now()
  };
  store.set("skins", [...store.get("skins"), entry]);
  return listSkins();
}
async function addSkinFromUrl(url, name, variant) {
  const res = await fetchWithRetry(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  assertPng(buffer);
  await promises.mkdir(paths.skins, { recursive: true });
  const id = node_crypto.randomUUID();
  const dest = node_path.join(paths.skins, `${id}.png`);
  await promises.writeFile(dest, buffer);
  const entry = { id, name: name.trim() || "Imported skin", path: dest, variant, addedAt: Date.now() };
  store.set("skins", [...store.get("skins"), entry]);
  return listSkins();
}
async function removeSkin(id) {
  const entry = store.get("skins").find((s) => s.id === id);
  if (entry) await promises.rm(entry.path, { force: true });
  store.set(
    "skins",
    store.get("skins").filter((s) => s.id !== id)
  );
  return listSkins();
}
function renameSkin(id, name) {
  const skins = store.get("skins").map((s) => s.id === id ? { ...s, name } : s);
  store.set("skins", skins);
  return listSkins();
}
async function readSkinDataUrl(id) {
  const entry = store.get("skins").find((s) => s.id === id);
  if (!entry) throw new Error("Skin not found");
  const buffer = await promises.readFile(entry.path);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
class SkinNotSupported extends Error {
  constructor() {
    super(
      "Offline accounts cannot upload skins — Mojang only serves skins for accounts that own the game. The skin library still works for singleplayer with a skin-loading mod, and for servers that run their own skin system."
    );
    this.name = "SkinNotSupported";
  }
}
async function applySkin(accountId, skinId) {
  const account = await ensureValidSession(accountId);
  if (account.kind !== "microsoft" || !account.accessToken) throw new SkinNotSupported();
  const entry = store.get("skins").find((s) => s.id === skinId);
  if (!entry) throw new Error("Skin not found");
  const buffer = await promises.readFile(entry.path);
  assertPng(buffer);
  const form = new FormData();
  form.append("variant", entry.variant);
  form.append("file", new Blob([buffer], { type: "image/png" }), "skin.png");
  const res = await fetch(SKIN_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${account.accessToken}` },
    body: form
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mojang rejected the skin upload (HTTP ${res.status}). ${body.slice(0, 200)}`);
  }
}
async function resetSkin(accountId) {
  const account = await ensureValidSession(accountId);
  if (account.kind !== "microsoft" || !account.accessToken) throw new SkinNotSupported();
  const res = await fetch(SKIN_API, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${account.accessToken}` }
  });
  if (!res.ok) throw new Error(`Could not reset the skin (HTTP ${res.status}).`);
}
async function setCape(accountId, capeId) {
  const account = await ensureValidSession(accountId);
  if (account.kind !== "microsoft" || !account.accessToken) throw new SkinNotSupported();
  const res = await fetch(CAPE_API, {
    method: capeId ? "PUT" : "DELETE",
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": "application/json"
    },
    body: capeId ? JSON.stringify({ capeId }) : void 0
  });
  if (!res.ok) throw new Error(`Could not change the cape (HTTP ${res.status}).`);
}
const TAG = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12
};
class Reader {
  constructor(buf) {
    this.buf = buf;
  }
  offset = 0;
  byte() {
    return this.buf.readInt8(this.offset++);
  }
  short() {
    const v = this.buf.readInt16BE(this.offset);
    this.offset += 2;
    return v;
  }
  int() {
    const v = this.buf.readInt32BE(this.offset);
    this.offset += 4;
    return v;
  }
  long() {
    const v = this.buf.readBigInt64BE(this.offset);
    this.offset += 8;
    return v;
  }
  float() {
    const v = this.buf.readFloatBE(this.offset);
    this.offset += 4;
    return v;
  }
  double() {
    const v = this.buf.readDoubleBE(this.offset);
    this.offset += 8;
    return v;
  }
  string() {
    const length = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    const v = this.buf.toString("utf8", this.offset, this.offset + length);
    this.offset += length;
    return v;
  }
  bytes(count) {
    const v = this.buf.subarray(this.offset, this.offset + count);
    this.offset += count;
    return Buffer.from(v);
  }
  get done() {
    return this.offset >= this.buf.length;
  }
  payload(type) {
    switch (type) {
      case TAG.Byte:
        return this.byte();
      case TAG.Short:
        return this.short();
      case TAG.Int:
        return this.int();
      case TAG.Long:
        return this.long();
      case TAG.Float:
        return this.float();
      case TAG.Double:
        return this.double();
      case TAG.ByteArray:
        return this.bytes(this.int());
      case TAG.String:
        return this.string();
      case TAG.List: {
        const elementType = this.byte();
        const count = this.int();
        const items = [];
        for (let i = 0; i < count; i++) items.push(this.payload(elementType));
        items.elementType = elementType;
        return items;
      }
      case TAG.Compound: {
        const out = {};
        for (; ; ) {
          const tagType = this.byte();
          if (tagType === TAG.End) break;
          const name = this.string();
          const value = this.payload(tagType);
          const tagged = { type: tagType, value };
          if (tagType === TAG.List) {
            tagged.listType = value.elementType ?? TAG.End;
          }
          out[name] = tagged;
        }
        return out;
      }
      case TAG.IntArray: {
        const count = this.int();
        const arr = [];
        for (let i = 0; i < count; i++) arr.push(this.int());
        return arr;
      }
      case TAG.LongArray: {
        const count = this.int();
        const arr = [];
        for (let i = 0; i < count; i++) arr.push(this.long());
        return arr;
      }
      default:
        throw new Error(`Unsupported NBT tag type ${type}`);
    }
  }
}
class Writer {
  chunks = [];
  byte(v) {
    const b = Buffer.alloc(1);
    b.writeInt8(v);
    this.chunks.push(b);
  }
  short(v) {
    const b = Buffer.alloc(2);
    b.writeInt16BE(v);
    this.chunks.push(b);
  }
  int(v) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v);
    this.chunks.push(b);
  }
  long(v) {
    const b = Buffer.alloc(8);
    b.writeBigInt64BE(v);
    this.chunks.push(b);
  }
  float(v) {
    const b = Buffer.alloc(4);
    b.writeFloatBE(v);
    this.chunks.push(b);
  }
  double(v) {
    const b = Buffer.alloc(8);
    b.writeDoubleBE(v);
    this.chunks.push(b);
  }
  string(v) {
    const data = Buffer.from(v, "utf8");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(data.length);
    this.chunks.push(len, data);
  }
  raw(b) {
    this.chunks.push(b);
  }
  result() {
    return Buffer.concat(this.chunks);
  }
  payload(type, value, listType) {
    switch (type) {
      case TAG.Byte:
        return this.byte(Number(value));
      case TAG.Short:
        return this.short(Number(value));
      case TAG.Int:
        return this.int(Number(value));
      case TAG.Long:
        return this.long(BigInt(value));
      case TAG.Float:
        return this.float(Number(value));
      case TAG.Double:
        return this.double(Number(value));
      case TAG.ByteArray: {
        const buf = value;
        this.int(buf.length);
        return this.raw(buf);
      }
      case TAG.String:
        return this.string(String(value));
      case TAG.List: {
        const items = value;
        const element = listType ?? items.elementType ?? TAG.End;
        this.byte(items.length === 0 ? TAG.End : element);
        this.int(items.length);
        for (const item of items) this.payload(element, item);
        return;
      }
      case TAG.Compound: {
        const map = value;
        for (const [name, tag] of Object.entries(map)) {
          this.byte(tag.type);
          this.string(name);
          this.payload(tag.type, tag.value, tag.listType);
        }
        return this.byte(TAG.End);
      }
      case TAG.IntArray: {
        const arr = value;
        this.int(arr.length);
        for (const n of arr) this.int(n);
        return;
      }
      default:
        throw new Error(`Unsupported NBT tag type ${type}`);
    }
  }
}
function readNbt(input) {
  const gzipped = input[0] === 31 && input[1] === 139;
  const buf = gzipped ? node_zlib.gunzipSync(input) : input;
  const reader = new Reader(buf);
  const type = reader.byte();
  if (type !== TAG.Compound) throw new Error("NBT root is not a compound tag");
  const rootName = reader.string();
  const root2 = reader.payload(TAG.Compound);
  return { rootName, root: root2, gzipped };
}
function writeNbt(file) {
  const writer = new Writer();
  writer.byte(TAG.Compound);
  writer.string(file.rootName);
  writer.payload(TAG.Compound, file.root);
  const out = writer.result();
  return file.gzipped ? node_zlib.gzipSync(out) : out;
}
function datPath(instanceId) {
  return node_path.join(instanceDir(instanceId), "servers.dat");
}
function emptyFile() {
  return {
    rootName: "",
    root: { servers: { type: TAG.List, value: [], listType: TAG.Compound } },
    gzipped: false
  };
}
async function listServers(instanceId) {
  const path = datPath(instanceId);
  if (!node_fs.existsSync(path)) return [];
  try {
    const file = readNbt(await promises.readFile(path));
    const list = file.root.servers?.value;
    if (!Array.isArray(list)) return [];
    return list.map((entry) => ({
      name: String(entry.name?.value ?? "Server"),
      address: String(entry.ip?.value ?? ""),
      icon: entry.icon ? String(entry.icon.value) : void 0,
      acceptTextures: entry.acceptTextures !== void 0 ? Number(entry.acceptTextures.value) : void 0
    }));
  } catch {
    return [];
  }
}
async function save(instanceId, servers) {
  const path = datPath(instanceId);
  let file;
  try {
    file = node_fs.existsSync(path) ? readNbt(await promises.readFile(path)) : emptyFile();
  } catch {
    file = emptyFile();
  }
  const encoded = servers.map((server) => {
    const entry = {
      name: { type: TAG.String, value: server.name },
      ip: { type: TAG.String, value: server.address }
    };
    if (server.icon) entry.icon = { type: TAG.String, value: server.icon };
    if (server.acceptTextures !== void 0) {
      entry.acceptTextures = { type: TAG.Byte, value: server.acceptTextures };
    }
    return entry;
  });
  file.root.servers = { type: TAG.List, value: encoded, listType: TAG.Compound };
  await promises.writeFile(path, writeNbt(file));
  return listServers(instanceId);
}
async function addServer(instanceId, entry) {
  const name = entry.name.trim();
  const address = entry.address.trim();
  if (!name) throw new Error("Give the server a name.");
  if (!address) throw new Error("Enter the server address.");
  const servers = await listServers(instanceId);
  if (servers.some((s) => s.address.toLowerCase() === address.toLowerCase())) {
    throw new Error(`${address} is already in this instance's server list.`);
  }
  return save(instanceId, [...servers, { name, address }]);
}
async function updateServer(instanceId, index, patch) {
  const servers = await listServers(instanceId);
  if (!servers[index]) throw new Error("Server not found.");
  servers[index] = { ...servers[index], ...patch };
  return save(instanceId, servers);
}
async function removeServer(instanceId, index) {
  const servers = await listServers(instanceId);
  if (!servers[index]) throw new Error("Server not found.");
  servers.splice(index, 1);
  return save(instanceId, servers);
}
async function moveServer(instanceId, index, delta) {
  const servers = await listServers(instanceId);
  const target = index + delta;
  if (!servers[index] || target < 0 || target >= servers.length) return servers;
  const [entry] = servers.splice(index, 1);
  servers.splice(target, 0, entry);
  return save(instanceId, servers);
}
function writeVarInt(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let byte = v & 127;
    v >>>= 7;
    if (v !== 0) byte |= 128;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}
function readVarInt(buf, offset) {
  let result = 0;
  let shift = 0;
  let size = 0;
  for (; ; ) {
    if (offset + size >= buf.length) return null;
    const byte = buf[offset + size];
    result |= (byte & 127) << shift;
    size++;
    if ((byte & 128) === 0) break;
    shift += 7;
    if (shift > 35) return null;
  }
  return { value: result >>> 0, size };
}
function packet(id, payload) {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}
function mcString(value) {
  const data = Buffer.from(value, "utf8");
  return Buffer.concat([writeVarInt(data.length), data]);
}
function flattenMotd(description) {
  if (typeof description === "string") return description;
  if (!description || typeof description !== "object") return "";
  const node = description;
  let out = node.text ?? node.translate ?? "";
  for (const child of node.extra ?? []) out += flattenMotd(child);
  return out;
}
function stripFormatting(text) {
  return text.replace(/§[0-9a-fk-orA-FK-OR]/g, "");
}
function pingServer(address, timeoutMs = 5e3) {
  return new Promise((resolve) => {
    let host = address.trim();
    let port = 25565;
    host = host.replace(/^[a-z]+:\/\//i, "");
    const lastColon = host.lastIndexOf(":");
    if (lastColon !== -1 && !host.includes("]") && host.indexOf(":") === lastColon) {
      const maybePort = Number(host.slice(lastColon + 1));
      if (Number.isInteger(maybePort) && maybePort > 0 && maybePort < 65536) {
        port = maybePort;
        host = host.slice(0, lastColon);
      }
    }
    const started = Date.now();
    const chunks = [];
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };
    const socket = node_net.connect({ host, port, timeout: timeoutMs });
    socket.on("connect", () => {
      const handshake = packet(
        0,
        Buffer.concat([
          writeVarInt(47),
          // any modern protocol number works for status
          mcString(host),
          (() => {
            const b = Buffer.alloc(2);
            b.writeUInt16BE(port);
            return b;
          })(),
          writeVarInt(1)
        ])
      );
      socket.write(Buffer.concat([handshake, packet(0, Buffer.alloc(0))]));
    });
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      const outer = readVarInt(buf, 0);
      if (!outer) return;
      if (buf.length < outer.size + outer.value) return;
      let cursor = outer.size;
      const id = readVarInt(buf, cursor);
      if (!id) return;
      cursor += id.size;
      const strLen = readVarInt(buf, cursor);
      if (!strLen) return;
      cursor += strLen.size;
      try {
        const json = JSON.parse(buf.toString("utf8", cursor, cursor + strLen.value));
        finish({
          online: true,
          motd: stripFormatting(flattenMotd(json.description)).trim(),
          playersOnline: json.players?.online,
          playersMax: json.players?.max,
          version: json.version?.name,
          protocol: json.version?.protocol,
          favicon: json.favicon,
          latencyMs: Date.now() - started
        });
      } catch {
        finish({ online: false, error: "Server sent an unreadable status response." });
      }
    });
    socket.on("timeout", () => finish({ online: false, error: "Timed out" }));
    socket.on("error", (err) => {
      const reason = err.code === "ENOTFOUND" ? "Address not found" : err.code === "ECONNREFUSED" ? "Connection refused" : err.message;
      finish({ online: false, error: reason });
    });
  });
}
const API$1 = "https://api.modrinth.com/v2";
const LOADER_NAMES = /* @__PURE__ */ new Set([
  "fabric",
  "forge",
  "neoforge",
  "quilt",
  "liteloader",
  "modloader",
  "rift",
  "bukkit",
  "paper",
  "iris",
  "optifine",
  "canvas",
  "vanilla",
  "minecraft"
]);
function toProject$1(hit) {
  return {
    id: hit.project_id,
    source: "modrinth",
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    iconUrl: hit.icon_url || void 0,
    downloads: hit.downloads,
    follows: hit.follows,
    author: hit.author,
    // Modrinth mixes loaders into the category list; split them back out so the
    // UI can show real categories as tags.
    categories: (hit.display_categories ?? hit.categories).filter((c) => !LOADER_NAMES.has(c)),
    loaders: hit.categories.filter((c) => LOADER_NAMES.has(c)),
    gameVersions: hit.versions,
    projectType: hit.project_type ?? "mod",
    updated: hit.date_modified,
    clientSide: hit.client_side,
    serverSide: hit.server_side
  };
}
async function search$1(query) {
  const facets = [[`project_type:${query.projectType}`]];
  const loaderFilterable = query.projectType === "mod" || query.projectType === "modpack";
  if (query.loader && query.loader !== "vanilla" && loaderFilterable) {
    facets.push([`categories:${query.loader}`]);
  }
  if (query.gameVersion) facets.push([`versions:${query.gameVersion}`]);
  for (const category of query.categories ?? []) facets.push([`categories:${category}`]);
  const params = new URLSearchParams({
    query: query.query,
    facets: JSON.stringify(facets),
    index: query.sort ?? "relevance",
    offset: String(query.offset ?? 0),
    limit: String(query.limit ?? 20)
  });
  const data = await getJson(
    `${API$1}/search?${params}`
  );
  return {
    hits: data.hits.map(toProject$1),
    total: data.total_hits,
    offset: data.offset
  };
}
function toVersion$1(v) {
  const file = v.files.find((f) => f.primary) ?? v.files[0];
  if (!file) return null;
  return {
    id: v.id,
    source: "modrinth",
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    releaseType: v.version_type,
    datePublished: v.date_published,
    downloads: v.downloads,
    fileName: file.filename,
    fileUrl: file.url,
    fileSize: file.size,
    sha1: file.hashes.sha1,
    dependencies: v.dependencies.map((d) => ({
      projectId: d.project_id,
      versionId: d.version_id ?? void 0,
      type: d.dependency_type
    }))
  };
}
async function listVersions$1(projectId, gameVersion, loader) {
  const params = new URLSearchParams();
  if (gameVersion) params.set("game_versions", JSON.stringify([gameVersion]));
  if (loader && loader !== "vanilla") params.set("loaders", JSON.stringify([loader]));
  const suffix = params.toString() ? `?${params}` : "";
  const versions = await getJson(`${API$1}/project/${projectId}/version${suffix}`);
  return versions.map(toVersion$1).filter((v) => v !== null);
}
async function getProject$1(idOrSlug) {
  const p = await getJson(`${API$1}/project/${idOrSlug}`);
  return {
    ...toProject$1({ ...p, project_id: p.id, author: "", follows: p.follows ?? 0 }),
    gameVersions: p.game_versions ?? [],
    loaders: p.loaders ?? [],
    body: p.body ?? ""
  };
}
async function listCategories() {
  const cats = await getJsonCached(
    `${API$1}/tag/category`,
    24 * 60 * 60 * 1e3
  );
  return cats.map((c) => ({ name: c.name, projectType: c.project_type }));
}
async function versionsFromHashes(hashes) {
  if (!hashes.length) return {};
  const data = await getJson(
    `${API$1}/version_files`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashes, algorithm: "sha1" })
    }
  );
  const out = {};
  for (const [hash, version] of Object.entries(data)) {
    const mapped = toVersion$1(version);
    if (mapped) out[hash] = { ...mapped, projectId: version.project_id };
  }
  return out;
}
const API = "https://api.curseforge.com/v1";
const GAME_ID = 432;
const CLASS_IDS = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552,
  datapack: 6945
};
const CLASS_TO_TYPE = Object.fromEntries(
  Object.entries(CLASS_IDS).map(([type, id]) => [id, type])
);
const LOADER_IDS = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
};
const LOADER_NAME_BY_ID = {
  1: "forge",
  2: "cauldron",
  3: "liteloader",
  4: "fabric",
  5: "quilt",
  6: "neoforge"
};
class CurseForgeKeyMissing extends Error {
  constructor() {
    super("No CurseForge API key configured.");
    this.name = "CurseForgeKeyMissing";
  }
}
function headers() {
  const key = store.get("settings").curseforgeApiKey.trim();
  if (!key) throw new CurseForgeKeyMissing();
  return { "x-api-key": key, Accept: "application/json" };
}
async function cfJson(url) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: headers() });
    if (res.ok) return await res.json();
    lastStatus = res.status;
    if (res.status !== 403 && res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
  }
  if (lastStatus === 403 || lastStatus === 429) {
    throw new Error(
      "CurseForge is rate-limiting or rejecting this request (HTTP 403). Wait a moment and retry — if it persists, check your API key in Settings → Integrations."
    );
  }
  throw new Error(`CurseForge request failed (HTTP ${lastStatus}).`);
}
function hasApiKey() {
  return store.get("settings").curseforgeApiKey.trim().length > 0;
}
function toProject(mod) {
  const indexes = mod.latestFilesIndexes ?? [];
  return {
    id: String(mod.id),
    source: "curseforge",
    slug: mod.slug,
    title: mod.name,
    description: mod.summary,
    iconUrl: mod.logo?.thumbnailUrl,
    downloads: mod.downloadCount,
    follows: mod.thumbsUpCount ?? 0,
    author: mod.authors?.[0]?.name,
    categories: mod.categories?.map((c) => c.name) ?? [],
    loaders: [
      ...new Set(
        indexes.map((i) => i.modLoader !== void 0 ? LOADER_NAME_BY_ID[i.modLoader] : void 0).filter((l) => Boolean(l))
      )
    ],
    gameVersions: [...new Set(indexes.map((i) => i.gameVersion))],
    projectType: CLASS_TO_TYPE[mod.classId] ?? "mod",
    updated: mod.dateModified
  };
}
async function search(query) {
  const params = new URLSearchParams({
    gameId: String(GAME_ID),
    classId: String(CLASS_IDS[query.projectType]),
    searchFilter: query.query,
    sortField: query.sort === "downloads" ? "6" : query.sort === "updated" ? "3" : "2",
    sortOrder: "desc",
    index: String(query.offset ?? 0),
    pageSize: String(Math.min(50, query.limit ?? 20))
  });
  if (query.gameVersion) params.set("gameVersion", query.gameVersion);
  const loaderFilterable = query.projectType === "mod" || query.projectType === "modpack";
  if (query.loader && LOADER_IDS[query.loader] && loaderFilterable) {
    params.set("modLoaderType", String(LOADER_IDS[query.loader]));
  }
  const data = await cfJson(`${API}/mods/search?${params}`);
  return {
    hits: data.data.map(toProject),
    // CurseForge caps deep paging at 10 000 results.
    total: Math.min(data.pagination.totalCount, 1e4),
    offset: data.pagination.index
  };
}
const RELEASE_TYPES = {
  1: "release",
  2: "beta",
  3: "alpha"
};
const RELATION_TYPES = { 2: "optional", 3: "required", 4: "tool", 5: "incompatible" };
function toVersion(file, modId) {
  const loaderNames = new Set(Object.keys(LOADER_IDS));
  return {
    id: String(file.id),
    source: "curseforge",
    name: file.displayName,
    versionNumber: file.displayName,
    gameVersions: file.gameVersions.filter((v) => !loaderNames.has(v.toLowerCase())),
    loaders: file.gameVersions.filter((v) => loaderNames.has(v.toLowerCase())).map((v) => v.toLowerCase()),
    releaseType: RELEASE_TYPES[file.releaseType] ?? "release",
    datePublished: file.fileDate,
    downloads: file.downloadCount,
    fileName: file.fileName,
    // Some authors disable third-party downloads; the CDN path still resolves.
    fileUrl: file.downloadUrl ?? fallbackUrl(file),
    fileSize: file.fileLength,
    sha1: file.hashes?.find((h) => h.algo === 1)?.value,
    dependencies: (file.dependencies ?? []).map((d) => ({
      projectId: String(d.modId),
      type: RELATION_TYPES[d.relationType] ?? "optional"
    }))
  };
}
function fallbackUrl(file) {
  const id = String(file.id);
  return `https://mediafilez.forgecdn.net/files/${id.slice(0, 4)}/${Number(id.slice(4))}/${file.fileName}`;
}
async function listVersions(modId, gameVersion, loader) {
  const params = new URLSearchParams({ pageSize: "50" });
  if (gameVersion) params.set("gameVersion", gameVersion);
  if (loader && LOADER_IDS[loader]) params.set("modLoaderType", String(LOADER_IDS[loader]));
  const data = await cfJson(`${API}/mods/${modId}/files?${params}`);
  return data.data.map((f) => toVersion(f));
}
async function getProject(modId) {
  const [{ data: mod }, description] = await Promise.all([
    cfJson(`${API}/mods/${modId}`),
    cfJson(`${API}/mods/${modId}/description`).then((r) => r.data).catch(() => "")
  ]);
  return { ...toProject(mod), body: description };
}
const CONTENT_DIRS = {
  mod: "mods",
  shader: "shaderpacks",
  resourcepack: "resourcepacks",
  datapack: "datapacks"
};
const DISABLED_SUFFIX = ".disabled";
function contentDir(instanceId, type) {
  return node_path.join(instanceDir(instanceId), CONTENT_DIRS[type]);
}
function indexPath(instanceId, type) {
  return node_path.join(instanceDir(instanceId), ".brick", `${type}-index.json`);
}
async function readIndex(instanceId, type) {
  try {
    return JSON.parse(await promises.readFile(indexPath(instanceId, type), "utf8"));
  } catch {
    return {};
  }
}
async function writeIndex(instanceId, type, index) {
  const file = indexPath(instanceId, type);
  await promises.mkdir(node_path.join(file, ".."), { recursive: true });
  await promises.writeFile(file, JSON.stringify(index, null, 2));
}
function baseName(fileName) {
  return fileName.endsWith(DISABLED_SUFFIX) ? fileName.slice(0, -DISABLED_SUFFIX.length) : fileName;
}
async function listContent(instanceId, type) {
  const dir = contentDir(instanceId, type);
  await promises.mkdir(dir, { recursive: true });
  const index = await readIndex(instanceId, type);
  const entries = await promises.readdir(dir).catch(() => []);
  const files = entries.filter((f) => /\.(jar|zip)(\.disabled)?$/i.test(f));
  const results = [];
  for (const fileName of files) {
    const key = baseName(fileName);
    const info = await promises.stat(node_path.join(dir, fileName));
    const meta = index[key];
    results.push({
      fileName,
      name: meta?.name ?? key.replace(/\.(jar|zip)$/i, ""),
      source: meta?.source ?? "local",
      projectId: meta?.projectId,
      versionId: meta?.versionId,
      version: meta?.version,
      iconUrl: meta?.iconUrl,
      enabled: !fileName.endsWith(DISABLED_SUFFIX),
      sizeBytes: info.size
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
async function installContent(args) {
  const { instanceId, type, version, projectTitle, iconUrl } = args;
  const dir = contentDir(instanceId, type);
  await promises.mkdir(dir, { recursive: true });
  const index = await readIndex(instanceId, type);
  const projectId = version.projectId;
  if (projectId) {
    for (const [key, entry] of Object.entries(index)) {
      if (entry.projectId === projectId) {
        await promises.rm(node_path.join(dir, key), { force: true });
        await promises.rm(node_path.join(dir, key + DISABLED_SUFFIX), { force: true });
        delete index[key];
      }
    }
  }
  await downloadFile({
    url: version.fileUrl,
    dest: node_path.join(dir, version.fileName),
    sha1: version.sha1,
    size: version.fileSize
  });
  index[version.fileName] = {
    fileName: version.fileName,
    name: projectTitle,
    source: version.source,
    projectId: version.projectId,
    versionId: version.id,
    version: version.versionNumber,
    iconUrl
  };
  await writeIndex(instanceId, type, index);
  return listContent(instanceId, type);
}
async function setContentEnabled(instanceId, type, fileName, enabled) {
  const dir = contentDir(instanceId, type);
  const current = node_path.join(dir, fileName);
  const target = node_path.join(dir, enabled ? baseName(fileName) : `${baseName(fileName)}${DISABLED_SUFFIX}`);
  if (current !== target && node_fs.existsSync(current)) await promises.rename(current, target);
  return listContent(instanceId, type);
}
async function removeContent(instanceId, type, fileName) {
  const dir = contentDir(instanceId, type);
  await promises.rm(node_path.join(dir, fileName), { force: true });
  const index = await readIndex(instanceId, type);
  delete index[baseName(fileName)];
  await writeIndex(instanceId, type, index);
  return listContent(instanceId, type);
}
async function importLocalFiles(instanceId, type, filePaths) {
  const dir = contentDir(instanceId, type);
  await promises.mkdir(dir, { recursive: true });
  const allowed = type === "mod" ? /\.jar$/i : /\.(zip|jar)$/i;
  const skipped = [];
  let imported = 0;
  for (const source of filePaths) {
    const name = source.split(/[\\/]/).pop();
    if (!allowed.test(name)) {
      skipped.push(name);
      continue;
    }
    let dest = node_path.join(dir, name);
    let counter = 1;
    while (node_fs.existsSync(dest)) {
      dest = node_path.join(dir, name.replace(/(\.[^.]+)$/, `-${counter++}$1`));
    }
    await promises.writeFile(dest, await promises.readFile(source));
    imported++;
  }
  const content = imported > 0 ? await identifyLocalContent(instanceId, type) : await listContent(instanceId, type);
  return { content, imported, skipped };
}
function savesDir(instanceId) {
  return node_path.join(instanceDir(instanceId), "saves");
}
async function dirSize(dir) {
  let total = 0;
  const entries = await promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = node_path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await promises.stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}
async function listWorlds(instanceId) {
  const dir = savesDir(instanceId);
  await promises.mkdir(dir, { recursive: true });
  const entries = await promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  const worlds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = node_path.join(dir, entry.name);
    if (!node_fs.existsSync(node_path.join(full, "level.dat"))) continue;
    const iconPath = node_path.join(full, "icon.png");
    const icon = node_fs.existsSync(iconPath) ? `data:image/png;base64,${(await promises.readFile(iconPath)).toString("base64")}` : void 0;
    worlds.push({
      folderName: entry.name,
      name: entry.name,
      sizeBytes: await dirSize(full),
      lastPlayed: (await promises.stat(node_path.join(full, "level.dat")).catch(() => null))?.mtimeMs,
      icon
    });
  }
  return worlds.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
}
async function importWorld(instanceId, sourcePath) {
  const dir = savesDir(instanceId);
  await promises.mkdir(dir, { recursive: true });
  const info = await promises.stat(sourcePath);
  if (info.isDirectory()) {
    if (!node_fs.existsSync(node_path.join(sourcePath, "level.dat"))) {
      throw new Error("That folder is not a Minecraft world (no level.dat inside).");
    }
    const { cp } = await import("node:fs/promises");
    const name = sourcePath.split(/[\\/]/).filter(Boolean).pop();
    await cp(sourcePath, uniqueDir(dir, name), { recursive: true });
    return listWorlds(instanceId);
  }
  if (!/\.zip$/i.test(sourcePath)) {
    throw new Error("Worlds must be a .zip archive or an unpacked world folder.");
  }
  const zip = new AdmZip(sourcePath);
  const entries = zip.getEntries();
  const levelEntry = entries.find((e) => e.entryName.replace(/\\/g, "/").endsWith("level.dat"));
  if (!levelEntry) {
    throw new Error("That zip does not contain a Minecraft world (no level.dat inside).");
  }
  const prefix = levelEntry.entryName.replace(/\\/g, "/").slice(0, -"level.dat".length);
  const baseName2 = prefix.replace(/\/$/, "").split("/").pop() || sourcePath.split(/[\\/]/).pop().replace(/\.zip$/i, "");
  const target = uniqueDir(dir, baseName2);
  for (const entry of entries) {
    const path = entry.entryName.replace(/\\/g, "/");
    if (entry.isDirectory || !path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    if (!relative) continue;
    const dest = node_path.join(target, ...relative.split("/"));
    await promises.mkdir(node_path.join(dest, ".."), { recursive: true });
    await promises.writeFile(dest, entry.getData());
  }
  return listWorlds(instanceId);
}
function uniqueDir(parent, name) {
  let candidate = node_path.join(parent, name);
  let counter = 1;
  while (node_fs.existsSync(candidate)) candidate = node_path.join(parent, `${name} (${counter++})`);
  return candidate;
}
async function deleteWorld(instanceId, folderName) {
  await promises.rm(node_path.join(savesDir(instanceId), folderName), { recursive: true, force: true });
  return listWorlds(instanceId);
}
async function identifyLocalContent(instanceId, type) {
  const dir = contentDir(instanceId, type);
  const index = await readIndex(instanceId, type);
  const files = (await listContent(instanceId, type)).filter((f) => f.source === "local");
  if (!files.length) return listContent(instanceId, type);
  const hashes = {};
  for (const file of files) {
    const buf = await promises.readFile(node_path.join(dir, file.fileName)).catch(() => null);
    if (!buf) continue;
    hashes[node_crypto.createHash("sha1").update(buf).digest("hex")] = file.fileName;
  }
  const matches = await versionsFromHashes(Object.keys(hashes)).catch(() => ({}));
  const projectIds = [...new Set(Object.values(matches).map((m) => m.projectId))];
  const projects = await Promise.all(
    projectIds.map((id) => getProject$1(id).catch(() => null))
  );
  const byId = new Map(projects.filter(Boolean).map((p) => [p.id, p]));
  for (const [hash, version] of Object.entries(matches)) {
    const fileName = hashes[hash];
    if (!fileName) continue;
    const project = byId.get(version.projectId);
    index[baseName(fileName)] = {
      fileName: baseName(fileName),
      name: project?.title ?? version.name,
      source: "modrinth",
      projectId: version.projectId,
      versionId: version.id,
      version: version.versionNumber,
      iconUrl: project?.iconUrl
    };
  }
  await writeIndex(instanceId, type, index);
  return listContent(instanceId, type);
}
async function checkForUpdates(instanceId, type, gameVersion, loader) {
  const installed = await listContent(instanceId, type);
  const updates = [];
  for (const file of installed) {
    if (!file.projectId || file.source === "local") continue;
    try {
      const versions = file.source === "modrinth" ? await listVersions$1(file.projectId, gameVersion, loader) : await listVersions(file.projectId, gameVersion, loader);
      const latest = versions[0];
      if (latest && latest.id !== file.versionId) {
        updates.push({ fileName: file.fileName, current: file.version, latest });
      }
    } catch {
    }
  }
  return updates;
}
async function installMrPack(instanceId, packUrl, packSha1, concurrency, onProgress) {
  const dir = instanceDir(instanceId);
  await promises.mkdir(dir, { recursive: true });
  const packPath = node_path.join(paths.cache, `pack-${instanceId}.mrpack`);
  onProgress("Downloading modpack", "", 0.05);
  await downloadFile({ url: packUrl, dest: packPath, sha1: packSha1 });
  const zip = new AdmZip(packPath);
  const indexEntry = zip.getEntry("modrinth.index.json");
  if (!indexEntry) throw new Error("This file is not a valid Modrinth modpack (.mrpack).");
  const index = JSON.parse(indexEntry.getData().toString("utf8"));
  onProgress("Downloading pack content", `${index.files.length} files`, 0.1);
  const jobs = index.files.filter((f) => f.env?.client !== "unsupported").map((f) => ({
    url: f.downloads[0],
    dest: node_path.join(dir, ...f.path.split("/")),
    sha1: f.hashes.sha1,
    size: f.fileSize
  }));
  await downloadAll(jobs, concurrency, (p) => {
    onProgress("Downloading pack content", `${p.completed}/${p.total} · ${p.current}`, 0.1 + 0.8 * (p.completed / Math.max(1, p.total)));
  });
  onProgress("Applying overrides", "", 0.92);
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    const prefix = name.startsWith("overrides/") ? "overrides/" : name.startsWith("client-overrides/") ? "client-overrides/" : null;
    if (!prefix || entry.isDirectory) continue;
    const relative = name.slice(prefix.length);
    if (!relative) continue;
    const dest = node_path.join(dir, ...relative.split("/"));
    await promises.mkdir(node_path.join(dest, ".."), { recursive: true });
    await promises.writeFile(dest, entry.getData());
  }
  await promises.rm(packPath, { force: true });
  const deps = index.dependencies;
  const loader = deps["fabric-loader"] ? "fabric" : deps["quilt-loader"] ? "quilt" : deps.forge ? "forge" : deps.neoforge ? "neoforge" : "vanilla";
  onProgress("Modpack ready", index.name, 1);
  return {
    name: index.name,
    mcVersion: deps.minecraft,
    loader,
    loaderVersion: deps["fabric-loader"] ?? deps["quilt-loader"] ?? deps.forge ?? deps.neoforge ?? void 0
  };
}
function normalise(text) {
  return text.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/<[^>]+>/g, "").split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
}
const PATTERNS = {
  // " - Install sodium, any 0.9.x version."  /  " - Install fabric-api, any version."
  // The constraint is optional in two ways: the whole clause may be absent, and
  // "any version" carries no version token at all.
  install: /^\s*-\s*Install\s+([A-Za-z0-9_.\-+]+?)\s*(?:,\s*(?:any\s+(?:(\S+)\s+)?version|version\s+(\S+?)))?\s*\.?\s*$/i,
  // " - Replace mod 'Sodium' (sodium) 0.5.0 with version 0.9.1."
  replace: /^\s*-\s*Replace\s+mod\s+'([^']+)'\s*\(([A-Za-z0-9_.\-+]+)\)\s*(\S+)\s+with\s+version\s+(\S+?)\.?\s*$/i,
  // " - Remove mod 'Foo' (foo) 1.0."
  remove: /^\s*-\s*Remove\s+mod\s+'([^']+)'\s*\(([A-Za-z0-9_.\-+]+)\)/i,
  // " - Mod 'Iris' (iris) 1.11.2+mc26.2 requires any 0.9.x version of sodium, which is missing!"
  requires: /Mod\s+'([^']+)'\s*\([A-Za-z0-9_.\-+]+\)\s*\S*\s*requires\s+(?:any\s+(\S+?)\s+version|version\s+(\S+?))\s+of\s+([A-Za-z0-9_.\-+]+),\s*which\s+is\s+missing/i,
  // NeoForge/Forge: "Mod ID: 'jei', Requested by: 'x', Expected range: '[15,)', Actual version: '[MISSING]'"
  forgeMissing: /Mod ID:\s*'([^']+)',\s*Requested by:\s*'([^']*)',\s*Expected range:\s*'([^']*)',\s*Actual version:\s*'\[MISSING\]'/i
};
function hintFromMavenRange(range) {
  const match = range.match(/(\d+(?:\.\d+)*)/);
  return match ? match[1] : void 0;
}
function parseProblems(logText) {
  const lines = normalise(logText);
  const problems = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (p) => {
    const key = `${p.kind}:${p.modId}:${p.versionHint ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push(p);
  };
  for (const line of lines) {
    let m;
    if (m = line.match(PATTERNS.replace)) {
      push({
        kind: "replace",
        modId: m[2],
        versionHint: m[4],
        requiredBy: m[1],
        raw: line.trim()
      });
      continue;
    }
    if (m = line.match(PATTERNS.install)) {
      push({ kind: "missing", modId: m[1], versionHint: m[2] ?? m[3], raw: line.trim() });
      continue;
    }
    if (m = line.match(PATTERNS.remove)) {
      push({ kind: "remove", modId: m[2], requiredBy: m[1], raw: line.trim() });
      continue;
    }
    if (m = line.match(PATTERNS.requires)) {
      push({
        kind: "missing",
        modId: m[4],
        versionHint: m[2] ?? m[3],
        requiredBy: m[1],
        raw: line.trim()
      });
      continue;
    }
    if (m = line.match(PATTERNS.forgeMissing)) {
      push({
        kind: "missing",
        modId: m[1],
        versionHint: hintFromMavenRange(m[3]),
        requiredBy: m[2] || void 0,
        raw: line.trim()
      });
    }
  }
  return problems;
}
function versionTokens(value) {
  return [...value.matchAll(/\d+(?:\.\d+)+/g)].map((match) => match[0]);
}
function satisfiesHint(versionNumber, hint) {
  if (!hint || /^any$/i.test(hint)) return true;
  const prefix = hint.endsWith(".x") ? hint.slice(0, -1) : hint;
  return versionTokens(versionNumber).some(
    (token) => token === hint || token.startsWith(prefix)
  );
}
async function findProject(modId) {
  try {
    return await getProject$1(modId);
  } catch {
  }
  try {
    const result = await search$1({
      query: modId,
      source: "modrinth",
      projectType: "mod",
      limit: 10
    });
    const needle = modId.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return result.hits.find((h) => h.slug.replace(/[^a-z0-9]/gi, "").toLowerCase() === needle) ?? result.hits.find((h) => h.title.replace(/[^a-z0-9]/gi, "").toLowerCase() === needle) ?? result.hits[0] ?? null;
  } catch {
    return null;
  }
}
async function latestLogFor(instanceId) {
  try {
    const files = (await promises.readdir(paths.logs)).filter((f) => f.startsWith(`${instanceId}-`) && f.endsWith(".log")).sort();
    const newest = files[files.length - 1];
    if (!newest) return "";
    return await promises.readFile(node_path.join(paths.logs, newest), "utf8");
  } catch {
    return "";
  }
}
async function diagnose(args) {
  const text = args.logText?.trim() ? args.logText : await latestLogFor(args.instanceId);
  const problems = parseProblems(text);
  if (!problems.length) return { problems, fixes: [] };
  const installed = await listContent(args.instanceId, "mod").catch(() => []);
  const fixes = [];
  for (const problem of problems) {
    if (problem.kind === "remove") {
      const target = matchInstalledFile(installed, problem.modId);
      fixes.push({
        action: "remove",
        modId: problem.modId,
        reason: problem.raw,
        resolved: Boolean(target),
        targetFileName: target,
        note: target ? void 0 : "Could not tell which file provides this mod."
      });
      continue;
    }
    const project = await findProject(problem.modId);
    if (!project) {
      fixes.push({
        action: problem.kind === "replace" ? "replace" : "install",
        modId: problem.modId,
        reason: problem.raw,
        resolved: false,
        note: `Not found on Modrinth — install ${problem.modId} manually.`
      });
      continue;
    }
    const candidates = await listVersions$1(project.id, args.gameVersion, args.loader).catch(() => []);
    const matching = candidates.filter((v) => satisfiesHint(v.versionNumber, problem.versionHint));
    const chosen = matching[0] ?? candidates[0];
    fixes.push({
      action: problem.kind === "replace" ? "replace" : "install",
      modId: problem.modId,
      reason: problem.raw,
      resolved: Boolean(chosen),
      project: {
        id: project.id,
        title: project.title,
        iconUrl: project.iconUrl,
        source: "modrinth"
      },
      version: chosen,
      targetFileName: problem.kind === "replace" ? matchInstalledFile(installed, problem.modId) : void 0,
      note: !chosen ? `No build of ${project.title} for ${args.loader} ${args.gameVersion}.` : matching.length === 0 && problem.versionHint ? `No build matched ${problem.versionHint}; offering ${chosen.versionNumber}, the newest compatible one.` : void 0
    });
  }
  return { problems, fixes };
}
function matchInstalledFile(installed, modId) {
  const needle = modId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const flat = (value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return installed.find((f) => flat(f.fileName).includes(needle))?.fileName ?? installed.find((f) => flat(f.name).includes(needle))?.fileName;
}
function flatten(entries, features) {
  const out = [];
  for (const entry of entries ?? []) {
    if (typeof entry === "string") {
      out.push(entry);
      continue;
    }
    if (!rulesAllow(entry.rules, features)) continue;
    out.push(...Array.isArray(entry.value) ? entry.value : [entry.value]);
  }
  return out;
}
function substitute(args, vars) {
  return args.map(
    (arg) => arg.replace(/\$\{(\w+)\}/g, (whole, key) => vars[key] ?? whole)
  );
}
function buildClasspath(version) {
  const entries = [];
  for (const lib of version.libraries) {
    if (!libraryApplies(lib)) continue;
    if (lib.natives && !lib.downloads?.artifact) continue;
    const jar = libraryJarPath(lib);
    if (!entries.includes(jar)) entries.push(jar);
  }
  entries.push(node_path.join(paths.versions, version.id, `${version.id}.jar`));
  return entries;
}
function gameArguments(version, features) {
  if (version.arguments?.game?.length) return flatten(version.arguments.game, features);
  if (version.minecraftArguments) return version.minecraftArguments.split(" ").filter(Boolean);
  return [];
}
function jvmArguments(version, features) {
  if (version.arguments?.jvm?.length) return flatten(version.arguments.jvm, features);
  return ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"];
}
async function launchInstance(opts) {
  const { instance, account, settings, onProgress, onLog, onExit } = opts;
  const version = await installVersion(
    instance.versionId,
    settings.concurrentDownloads,
    (p) => onProgress(p.stage, p.detail, p.progress * 0.9)
  );
  const gameDir = instanceDir(instance.id);
  await promises.mkdir(gameDir, { recursive: true });
  await promises.mkdir(node_path.join(gameDir, "mods"), { recursive: true });
  onProgress("Locating Java", "", 0.92);
  const requiredMajor = version.javaVersion?.majorVersion ?? 8;
  const javaPath = await resolveJavaFor(
    requiredMajor,
    instance.javaPath || settings.javaPath || void 0,
    (detail, progress) => onProgress("Preparing Java", detail, 0.92 + progress * 0.06)
  );
  const nativesDir = nativesDirFor(version.id);
  const classpath = buildClasspath(version);
  const memory = instance.memoryMb || settings.defaultMemoryMb;
  const features = {
    is_demo_user: false,
    has_custom_resolution: Boolean(instance.width && instance.height),
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  };
  const assetsRoot = paths.assets;
  const assetIndexId = version.assetIndex?.id ?? version.assets ?? "legacy";
  const vars = {
    auth_player_name: account.username,
    version_name: version.id,
    game_directory: gameDir,
    assets_root: assetsRoot,
    game_assets: node_path.join(assetsRoot, "virtual", assetIndexId),
    assets_index_name: assetIndexId,
    auth_uuid: account.uuid.replace(/-/g, ""),
    auth_access_token: account.accessToken ?? "0",
    auth_session: account.accessToken ? `token:${account.accessToken}` : "0",
    auth_xuid: account.xuid ?? "0",
    clientid: "",
    user_type: account.kind === "microsoft" ? "msa" : "legacy",
    version_type: version.type ?? "release",
    natives_directory: nativesDir,
    launcher_name: "BrickLauncher",
    launcher_version: "1.0.0",
    classpath: classpath.join(node_path.delimiter),
    user_properties: "{}",
    library_directory: paths.libraries,
    classpath_separator: node_path.delimiter,
    resolution_width: String(instance.width ?? 854),
    resolution_height: String(instance.height ?? 480)
  };
  const args = [];
  args.push(`-Xmx${memory}M`, `-Xms${Math.min(512, memory)}M`);
  args.push(`-Dminecraft.launcher.brand=BrickLauncher`, `-Dminecraft.launcher.version=1.0.0`);
  const legacy = !version.arguments?.jvm?.length;
  if (node_os.platform() === "win32" && legacy) {
    args.push("-Dos.name=Windows 10", "-Dos.version=10.0");
  }
  const extraJvm = (instance.jvmArgs ?? settings.jvmArgs ?? "").trim();
  if (extraJvm) args.push(...extraJvm.split(/\s+/));
  args.push(...substitute(jvmArguments(version, features), vars));
  if (version.logging?.client) {
    const configFile = node_path.join(paths.assets, "log_configs", version.logging.client.file.id);
    args.push(version.logging.client.argument.replace("${path}", configFile));
  }
  args.push(version.mainClass);
  args.push(...substitute(gameArguments(version, features), vars));
  if (instance.width && instance.height) {
    if (!args.includes("--width")) args.push("--width", String(instance.width));
    if (!args.includes("--height")) args.push("--height", String(instance.height));
  }
  onProgress("Starting Minecraft", version.id, 1);
  const child = node_child_process.spawn(javaPath, args, {
    cwd: gameDir,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    // Some Windows-only mod code writes to %APPDATA% directly; point it at the
    // instance so those files stay contained. Harmless to leave alone elsewhere.
    env: node_os.platform() === "win32" ? { ...process.env, APPDATA: gameDir } : process.env
  });
  const logPath = node_path.join(paths.logs, `${instance.id}-${Date.now()}.log`);
  await promises.mkdir(paths.logs, { recursive: true });
  const logStream = node_fs.createWriteStream(logPath);
  logStream.write(`$ ${javaPath} ${args.join(" ")}

`);
  const pump = (chunk) => {
    const text = chunk.toString();
    logStream.write(text);
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) onLog(line);
    }
  };
  child.stdout?.on("data", pump);
  child.stderr?.on("data", pump);
  child.on("error", (err) => {
    onLog(`[launcher] Failed to start Java: ${err.message}`);
    logStream.end();
    onExit(-1);
  });
  child.on("exit", (code) => {
    logStream.end();
    onExit(code);
  });
  return { process: child, instanceId: instance.id, logPath };
}
async function repairInstance(versionId, concurrency, onProgress) {
  await installVersion(versionId, concurrency, (p) => onProgress(p.stage, p.detail, p.progress));
  await resolveVersionChain(versionId);
}
const running = /* @__PURE__ */ new Map();
function broadcast(channel, payload) {
  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
function makeReporter(label) {
  const id = node_crypto.randomUUID();
  broadcast("task:update", { id, label, detail: "", progress: 0, done: false });
  return {
    id,
    step: (stage, detail, progress) => broadcast("task:update", { id, label: stage || label, detail, progress, done: false }),
    done: () => broadcast("task:update", { id, label, detail: "", progress: 1, done: true }),
    fail: (message) => broadcast("task:update", { id, label, detail: "", progress: 1, done: true, error: message })
  };
}
function errorMessage(err) {
  if (err instanceof Error) {
    const hint = err.hint;
    return hint ? `${err.message}

${hint}` : err.message;
  }
  return String(err);
}
function handle(channel, fn) {
  electron.ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
}
function registerIpc() {
  handle("app:info", () => ({
    paths,
    platform: process.platform,
    arch: process.arch
  }));
  handle("app:openPath", async (target) => {
    await electron.shell.openPath(target);
  });
  handle("app:openExternal", async (url) => {
    if (!/^https?:\/\//i.test(url)) throw new Error("Refusing to open a non-web link.");
    await electron.shell.openExternal(url);
  });
  handle("app:readImage", async (filePath) => {
    if (!/\.(png|jpe?g|webp|gif)$/i.test(filePath)) {
      throw new Error("That file is not an image.");
    }
    const { readFile, stat } = await import("node:fs/promises");
    const info = await stat(filePath);
    if (info.size > 8 * 1024 * 1024) throw new Error("Image is too large (max 8 MB).");
    const buffer = await readFile(filePath);
    const ext = filePath.split(".").pop().toLowerCase();
    const mime = ext === "jpg" ? "jpeg" : ext;
    return `data:image/${mime};base64,${buffer.toString("base64")}`;
  });
  handle("app:pickFiles", async (options) => {
    const win = electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
    const result = await electron.dialog.showOpenDialog(win, {
      properties: [
        options.directory ? "openDirectory" : "openFile",
        ...options.multi ? ["multiSelections"] : []
      ],
      filters: options.filters
    });
    return result.canceled ? [] : result.filePaths;
  });
  handle("settings:get", () => store.get("settings"));
  handle("settings:set", (patch) => store.patchSettings(patch));
  handle("accounts:list", () => ({
    accounts: listAccounts(),
    activeId: getActiveAccountId()
  }));
  handle("accounts:signInMicrosoft", () => signIn());
  handle(
    "accounts:addOffline",
    (username) => addAccount(createOfflineAccount(username))
  );
  handle("accounts:remove", (id) => removeAccount(id));
  handle("accounts:setActive", (id) => {
    setActiveAccount(id);
    return getActiveAccountId();
  });
  handle("accounts:refresh", async (id) => {
    await ensureValidSession(id);
    return listAccounts();
  });
  handle("versions:list", (includeSnapshots) => listVersions$2(includeSnapshots));
  handle("versions:latest", async () => (await getVersionManifest()).latest);
  handle(
    "loaders:builds",
    (loader, mcVersion) => listLoaderBuilds(loader, mcVersion)
  );
  handle("java:detect", () => detectJavaRuntimes());
  handle("java:install", async (major) => {
    const task = makeReporter(`Installing Java ${major}`);
    try {
      const path = await downloadJava(
        major,
        (detail, progress) => task.step(`Installing Java ${major}`, detail, progress)
      );
      task.done();
      return path;
    } catch (err) {
      task.fail(errorMessage(err));
      throw err;
    }
  });
  handle("instances:list", () => listInstances());
  handle("instances:get", (id) => getInstance(id));
  handle("instances:create", async (args) => {
    const task = makeReporter(`Creating ${args.name}`);
    try {
      const instance = await createInstance(
        args,
        (stage, detail, progress) => task.step(stage, detail, progress)
      );
      task.done();
      broadcast("instances:changed", listInstances());
      return instance;
    } catch (err) {
      task.fail(errorMessage(err));
      broadcast("instances:changed", listInstances());
      throw err;
    }
  });
  handle("instances:update", (id, patch) => {
    const list = updateInstance(id, patch);
    broadcast("instances:changed", list);
    return list;
  });
  handle("instances:delete", async (id) => {
    const list = await deleteInstance(id);
    broadcast("instances:changed", list);
    return list;
  });
  handle("instances:duplicate", async (id, name) => {
    const list = await duplicateInstance(id, name);
    broadcast("instances:changed", list);
    return list;
  });
  handle("instances:openFolder", async (id) => {
    await electron.shell.openPath(instanceDir(id));
  });
  handle("instances:repair", async (id) => {
    const instance = getInstance(id);
    if (!instance) throw new Error("Instance not found");
    const task = makeReporter(`Repairing ${instance.name}`);
    try {
      await repairInstance(
        instance.versionId,
        store.get("settings").concurrentDownloads,
        (stage, detail, progress) => task.step(stage, detail, progress)
      );
      updateInstance(id, { installed: true });
      task.done();
      broadcast("instances:changed", listInstances());
    } catch (err) {
      task.fail(errorMessage(err));
      throw err;
    }
  });
  handle("game:launch", async (instanceId, accountId) => {
    if (running.has(instanceId)) throw new Error("That instance is already running.");
    const instance = getInstance(instanceId);
    if (!instance) throw new Error("Instance not found");
    const id = accountId ?? getActiveAccountId();
    if (!id) throw new Error("Add an account before launching.");
    const account = await ensureValidSession(id);
    const task = makeReporter(`Launching ${instance.name}`);
    broadcast("game:status", { state: "preparing", instanceId });
    try {
      const handle2 = await launchInstance({
        instance,
        account,
        settings: store.get("settings"),
        onProgress: (stage, detail, progress) => task.step(stage, detail, progress),
        onLog: (line) => broadcast("game:log", { instanceId, line }),
        onExit: (code) => {
          const entry = running.get(instanceId);
          if (entry) {
            recordPlaySession(instanceId, (Date.now() - entry.startedAt) / 1e3);
            running.delete(instanceId);
          }
          broadcast("instances:changed", listInstances());
          broadcast(
            "game:status",
            code === 0 || code === null ? { state: "idle" } : { state: "crashed", instanceId, code }
          );
        }
      });
      running.set(instanceId, { child: handle2.process, startedAt: Date.now() });
      updateInstance(instanceId, { installed: true, lastPlayed: Date.now() });
      task.done();
      broadcast("game:status", { state: "running", instanceId, pid: handle2.process.pid ?? -1 });
      broadcast("instances:changed", listInstances());
      if (store.get("settings").closeLauncherOnLaunch) {
        setTimeout(() => electron.BrowserWindow.getAllWindows().forEach((w) => w.minimize()), 3e3);
      }
      return { pid: handle2.process.pid, logPath: handle2.logPath };
    } catch (err) {
      task.fail(errorMessage(err));
      broadcast("game:status", { state: "idle" });
      throw err;
    }
  });
  handle("game:stop", (instanceId) => {
    const entry = running.get(instanceId);
    if (!entry) return false;
    entry.child.kill();
    return true;
  });
  handle("game:running", () => [...running.keys()]);
  handle(
    "content:list",
    (instanceId, type) => listContent(instanceId, type)
  );
  handle("content:install", async (args) => {
    const task = makeReporter(`Installing ${args.projectTitle}`);
    try {
      const list = await installContent(args);
      task.done();
      return list;
    } catch (err) {
      task.fail(errorMessage(err));
      throw err;
    }
  });
  handle(
    "content:setEnabled",
    (instanceId, type, fileName, enabled) => setContentEnabled(instanceId, type, fileName, enabled)
  );
  handle(
    "content:remove",
    (instanceId, type, fileName) => removeContent(instanceId, type, fileName)
  );
  handle(
    "content:identify",
    (instanceId, type) => identifyLocalContent(instanceId, type)
  );
  handle(
    "content:import",
    (instanceId, type, filePaths) => importLocalFiles(instanceId, type, filePaths)
  );
  handle(
    "content:checkUpdates",
    (instanceId, type, gameVersion, loader) => checkForUpdates(instanceId, type, gameVersion, loader)
  );
  handle("worlds:list", (instanceId) => listWorlds(instanceId));
  handle("worlds:import", async (instanceId, sourcePath) => {
    const task = makeReporter("Importing world");
    try {
      const list = await importWorld(instanceId, sourcePath);
      task.done();
      return list;
    } catch (err) {
      task.fail(errorMessage(err));
      throw err;
    }
  });
  handle(
    "worlds:delete",
    (instanceId, folderName) => deleteWorld(instanceId, folderName)
  );
  handle(
    "browse:search",
    (query) => query.source === "curseforge" ? search(query) : search$1(query)
  );
  handle(
    "browse:versions",
    (source, projectId, gameVersion, loader) => source === "curseforge" ? listVersions(projectId, gameVersion, loader) : listVersions$1(projectId, gameVersion, loader)
  );
  handle(
    "browse:project",
    (source, projectId) => source === "curseforge" ? getProject(projectId) : getProject$1(projectId)
  );
  handle("browse:categories", () => listCategories());
  handle("browse:curseforgeReady", () => hasApiKey());
  handle(
    "modpack:install",
    async (args) => {
      const task = makeReporter(`Installing ${args.name}`);
      try {
        const placeholder = await createInstanceRecord({
          name: args.name,
          mcVersion: "",
          loader: "vanilla",
          icon: args.icon
        });
        const info = await installMrPack(
          placeholder.id,
          args.packUrl,
          args.packSha1,
          store.get("settings").concurrentDownloads,
          (stage, detail, progress) => task.step(stage, detail, progress * 0.5)
        );
        const { versionId, loaderVersion } = await installLoader(
          info.loader,
          info.mcVersion,
          info.loaderVersion,
          store.get("settings").concurrentDownloads,
          (p) => task.step(p.stage, p.detail, 0.5 + p.progress * 0.2)
        );
        await installVersion(
          versionId,
          store.get("settings").concurrentDownloads,
          (p) => task.step(p.stage, p.detail, 0.7 + p.progress * 0.3)
        );
        updateInstance(placeholder.id, {
          name: info.name || args.name,
          mcVersion: info.mcVersion,
          loader: info.loader,
          loaderVersion,
          versionId,
          installed: true
        });
        await identifyLocalContent(placeholder.id, "mod").catch(() => {
        });
        task.done();
        broadcast("instances:changed", listInstances());
        return getInstance(placeholder.id);
      } catch (err) {
        task.fail(errorMessage(err));
        broadcast("instances:changed", listInstances());
        throw err;
      }
    }
  );
  handle("servers:list", (instanceId) => listServers(instanceId));
  handle(
    "servers:add",
    (instanceId, entry) => addServer(instanceId, entry)
  );
  handle(
    "servers:update",
    (instanceId, index, patch) => updateServer(instanceId, index, patch)
  );
  handle(
    "servers:remove",
    (instanceId, index) => removeServer(instanceId, index)
  );
  handle(
    "servers:move",
    (instanceId, index, delta) => moveServer(instanceId, index, delta)
  );
  handle("servers:ping", (address) => pingServer(address));
  handle("diagnose:analyze", async (instanceId, logText) => {
    const instance = getInstance(instanceId);
    if (!instance) throw new Error("Instance not found");
    return diagnose({
      instanceId,
      gameVersion: instance.mcVersion,
      loader: instance.loader,
      logText: logText ?? ""
    });
  });
  handle("diagnose:apply", async (instanceId, fixes) => {
    const instance = getInstance(instanceId);
    if (!instance) throw new Error("Instance not found");
    const task = makeReporter("Fixing mods");
    const applied = [];
    const failed = [];
    try {
      for (const [index, fix] of fixes.entries()) {
        task.step("Fixing mods", fix.modId, index / Math.max(1, fixes.length));
        try {
          if (fix.targetFileName && (fix.action === "remove" || fix.action === "replace")) {
            await removeContent(instanceId, "mod", fix.targetFileName);
          }
          if (fix.action !== "remove") {
            if (!fix.version || !fix.project) {
              failed.push(`${fix.modId}: nothing to install`);
              continue;
            }
            await installContent({
              instanceId,
              type: "mod",
              version: { ...fix.version, projectId: fix.project.id },
              projectTitle: fix.project.title,
              iconUrl: fix.project.iconUrl
            });
          }
          applied.push(fix.modId);
        } catch (err) {
          failed.push(`${fix.modId}: ${errorMessage(err)}`);
        }
      }
      task.done();
      return { applied, failed, content: await listContent(instanceId, "mod") };
    } catch (err) {
      task.fail(errorMessage(err));
      throw err;
    }
  });
  handle("skins:list", () => listSkins());
  handle(
    "skins:addFile",
    (filePath, name, variant) => addSkinFromFile(filePath, name, variant)
  );
  handle(
    "skins:addUrl",
    (url, name, variant) => addSkinFromUrl(url, name, variant)
  );
  handle("skins:remove", (id) => removeSkin(id));
  handle("skins:rename", (id, name) => renameSkin(id, name));
  handle("skins:dataUrl", (id) => readSkinDataUrl(id));
  handle("skins:apply", (accountId, skinId) => applySkin(accountId, skinId));
  handle("skins:reset", (accountId) => resetSkin(accountId));
  handle(
    "skins:setCape",
    (accountId, capeId) => setCape(accountId, capeId)
  );
  handle("logs:open", async () => {
    await electron.shell.openPath(paths.logs);
  });
  handle("logs:openInstance", async (instanceId) => {
    await electron.shell.openPath(node_path.join(instanceDir(instanceId), "logs"));
  });
}
function stopAllGames() {
  for (const { child } of running.values()) child.kill();
  running.clear();
}
const isDev = !electron.app.isPackaged;
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1e3,
    minHeight: 640,
    show: false,
    backgroundColor: "#0f1115",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Leave room for the traffic lights inside our own header bar.
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) electron.shell.openExternal(url);
    return { action: "deny" };
  });
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
electron.app.whenReady().then(() => {
  ensureDirs();
  store.load();
  registerIpc();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", stopAllGames);
