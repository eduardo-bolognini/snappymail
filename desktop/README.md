# EasyMail Desktop

EasyMail Desktop is self-contained. Electron starts the bundled FrankenPHP runtime on loopback, serves the bundled SnappyMail core, and opens it in an isolated mail window. No separate PHP, web server, Docker container, or hosted SnappyMail installation is required.

## Development

Node.js 22.12 or newer is required by the Electron packaging toolchain.

```sh
cd desktop
npm install
npm start
```

The first command downloads the official FrankenPHP runtime for the current platform and verifies its pinned SHA-256 checksum. The local server binds only to `127.0.0.1:38471`; override the port with `SNAPPYMAIL_DESKTOP_PORT` when necessary.

Mail data, accounts, settings, and locally discovered provider configurations are stored under Electron's user-data directory. Development builds keep using `~/Library/Application Support/snappymail-focus-desktop/snappymail-data` so existing local accounts are preserved after the EasyMail rename.

## Build

```sh
npm run build
```

Create distributable installers with `npm run dist`. For cross-compilation, set `SNAPPYMAIL_RUNTIME_TARGET` to a supported target such as `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, or `win32-x64` before preparing the runtime.

## Automatic updates

Installed builds check the public `eduardo-bolognini/snappymail` GitHub Releases feed shortly after startup and every four hours. New versions download in the background and install when EasyMail closes. The native completion notification can be clicked to restart and install immediately. Development builds never contact the update feed.

The `EasyMail desktop release` GitHub Actions workflow publishes the installers and `latest*.yml` metadata required by `electron-updater`. Before the first macOS release, configure these repository secrets:

- `MACOS_CSC_LINK`
- `MACOS_CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for notarization

Set the same version in `desktop/package.json` and `desktop/package-lock.json`, then create and push a tag such as `easymail-v0.2.0`. The repository workflow publishes macOS arm64, Windows x64, and Linux x64 artifacts. A local signed release can also be published with `GH_TOKEN` and `npm run release`.

## Notifications

New-mail notifications use SnappyMail's existing account-aware notification flow and the operating system notification center. EasyMail grants notification permission only to its loopback mail origin; other web permissions and external origins remain blocked. Notifications are enabled by default and can still be changed from the general settings page.

## Security model

- The mail backend listens only on the IPv4 loopback interface.
- The mail window has no Node.js integration and exposes only a narrow, context-isolated preload bridge.
- New windows and cross-origin navigation open in the system browser.
- Runtime downloads use a pinned version and SHA-256 digest.
- Writable SnappyMail state lives outside the application bundle with user-only permissions.
- The PHP process is terminated when the desktop app quits.
