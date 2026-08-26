# Brick Launcher

A Minecraft launcher for macOS with a Modrinth-style interface: every mod loader,
mod and shader browsing from Modrinth and CurseForge, a skin library, and
instances that stay completely separate from each other.

## Running it

```bash
npm install
npm run dev          # development, with hot reload
npm run build        # production build into out/
npm run dist:mac     # .dmg + .zip (arm64 and x64)
npm run dist:win     # .exe installer (NSIS) + portable .zip
npm run dist:linux   # .AppImage + .tar.gz
```

All artifacts land in `release/`. Icons are generated from `build/icon.svg`
into `.icns` (macOS), `.ico` (Windows) and `.png` (Linux).

**Cross-building caveat:** macOS can produce Windows and Linux packages, but
some targets need extra tooling that only exists on the native OS (or in
Docker). `zip` and `tar.gz` are pure-archive targets and always cross-build
cleanly; `nsis` and `AppImage` may require the host toolchain. Build on the
target OS, or in CI with a matrix, for guaranteed installers.

The packaged build is **unsigned** (`identity: null` in the electron-builder
config), so the first launch needs right-click → Open, or:

```bash
xattr -dr com.apple.quarantine "/Applications/Brick Launcher.app"
```

Set a real signing identity in `package.json` under `build.mac` if you have an
Apple Developer certificate.

> If you launch Electron from a VS Code integrated terminal, unset
> `ELECTRON_RUN_AS_NODE` first — VS Code sets it, and it makes Electron run your
> main script as plain Node:
> `env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .`

## What it does

**Accounts.** Microsoft sign-in (OAuth 2.0 with PKCE, Xbox Live → Minecraft
services) and offline accounts. Offline accounts get the same name-based UUID a
vanilla server computes, so worlds and permissions follow the player. They work
for singleplayer, LAN and offline-mode servers; servers with authentication
enabled will reject them, and Mojang will not accept skin uploads for them.

**Loaders.** Vanilla, Fabric, Quilt, Forge and NeoForge. Fabric and Quilt come
from their meta APIs. Forge and NeoForge run the real installer pipeline
locally — the launcher reads `install_profile.json`, resolves its `{TOKEN}` and
`[maven:coord]` arguments, and executes each processor (binary patching,
deobfuscation) exactly as the official installer GUI would.

**Content.** Search Modrinth and CurseForge for mods, modpacks, resource packs
and shaders, normalised onto one result shape. Install into any instance, with
older versions of the same project replaced rather than stacked. Locally added
jars are identified by SHA-1 against Modrinth so they still get a name, icon and
update path. Modrinth `.mrpack` modpacks install as a new instance.

**Uploads.** Bring your own files: mods (`.jar`), resource packs and shaders
(`.zip`), and worlds — either a `.zip` (the wrapper folder is detected and
stripped) or an unpacked world folder.

**Java.** Detects installed JVMs via `/usr/libexec/java_home`, Homebrew and
`JAVA_HOME`, de-duplicated by their real `java.home`. If a version needs a Java
you do not have, a matching Eclipse Temurin JRE is downloaded from Adoptium
automatically.

**Skins.** A local skin library with classic/slim variants, applied to Microsoft
accounts through Mojang's own endpoint, plus cape selection.

## Setup that needs your own keys

Two integrations require credentials that cannot be shipped in an open source
app. Everything else works out of the box.

| Feature | What you need | Where |
| --- | --- | --- |
| Microsoft sign-in | An Azure application (client) ID | Settings → Accounts |
| CurseForge browsing | A free CurseForge API key | Settings → Integrations |

For Microsoft sign-in, register a free app at
[portal.azure.com](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade),
add the **Mobile and desktop applications** platform, and set the redirect URI to
`https://login.microsoftonline.com/common/oauth2/nativeclient`.
Offline accounts, Modrinth, all loaders and everything else work without it.

## Layout

```
src/
  main/                  Electron main process
    minecraft/           manifest, rules, install, launch, java
    loaders/             fabricLike (Fabric/Quilt), forgeLike (Forge/NeoForge)
    mods/                modrinth, curseforge, content (install + worlds)
    auth/                microsoft OAuth, account store
    ipc.ts               every renderer-facing channel
  preload/               contextBridge surface
  renderer/              React UI
  shared/types.ts        types both processes speak
```

Game data lives under `~/Library/Application Support/brick-launcher/data`:
`shared/` holds the deduplicated vanilla versions, libraries and assets;
`instances/<id>/` is the game directory Minecraft actually sees.

## Notes

Downloads are verified by SHA-1 and written through a temp file, so an
interrupted install resumes cleanly and a corrupted file is re-fetched rather
than silently used. "Verify & repair" on an instance re-runs that check over
every file.
