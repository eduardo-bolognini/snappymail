const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION = 'v1.12.4';
const assets = {
  'darwin-arm64': {
    name: 'frankenphp-mac-arm64',
    sha256: '5184b8a125fd43115ccdf23b801fa67fcaedf2679b8d6b977f6f35d1e8373322'
  },
  'darwin-x64': {
    name: 'frankenphp-mac-x86_64',
    sha256: 'd92148db0524d5599c180f05df6ebc201184cbc6e37bec78718387e818bf7cae'
  },
  'linux-arm64': {
    name: 'frankenphp-linux-aarch64',
    sha256: '632a33cacf49608db3ad8dc8b6d4e4846ac1e27a8a2e07379721a7634d40b9f6'
  },
  'linux-x64': {
    name: 'frankenphp-linux-x86_64',
    sha256: 'b2af72f6905af861fa58c3c8601386a481b46eabf647b6276486f5fa4da1f805'
  },
  'win32-x64': {
    name: 'frankenphp-windows-x86_64.zip',
    sha256: '3c64c2025787d14cb632b50ca49b0f39b3f8dad4a3aae403c8d99ac6936f7450',
    archive: true
  }
};

const targetKey = process.env.SNAPPYMAIL_RUNTIME_TARGET || `${process.platform}-${process.arch}`;
const asset = assets[targetKey];
if (!asset) throw new Error(`Unsupported FrankenPHP target: ${targetKey}`);

const runtimeDir = path.resolve(__dirname, '..', 'runtime');
const executableName = targetKey.startsWith('win32') ? 'frankenphp.exe' : 'frankenphp';
const executablePath = path.join(runtimeDir, executableName);
const markerPath = path.join(runtimeDir, '.runtime-version');

function digest(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many download redirects'));
    const request = https.get(url, { headers: { 'User-Agent': 'SnappyMail-Focus-Builder' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return resolve(download(response.headers.location, destination, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Download failed with HTTP ${response.statusCode}`));
      }
      const total = Number(response.headers['content-length']) || 0;
      let received = 0;
      let lastPercent = -1;
      const output = fs.createWriteStream(destination, { mode: 0o700 });
      response.on('data', chunk => {
        received += chunk.length;
        const percent = total ? Math.floor(received / total * 100) : 0;
        if (total && percent !== lastPercent) {
          lastPercent = percent;
          process.stdout.write(`\rDownloading PHP runtime ${percent}%`);
        }
      });
      response.pipe(output);
      output.once('finish', () => output.close(() => {
        process.stdout.write('\n');
        resolve();
      }));
      output.once('error', reject);
    });
    request.once('error', reject);
  });
}

async function main() {
  if (fs.existsSync(executablePath) && fs.existsSync(markerPath)
      && fs.readFileSync(markerPath, 'utf8').trim() === `${VERSION}:${targetKey}`) {
    console.log(`FrankenPHP ${VERSION} already prepared for ${targetKey}`);
    return;
  }

  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const downloadPath = path.join(runtimeDir, asset.name);
  const url = `https://github.com/php/frankenphp/releases/download/${VERSION}/${asset.name}`;
  await download(url, downloadPath);

  const actualDigest = digest(downloadPath);
  if (actualDigest !== asset.sha256) {
    fs.rmSync(downloadPath, { force: true });
    throw new Error(`FrankenPHP checksum mismatch: expected ${asset.sha256}, received ${actualDigest}`);
  }

  if (asset.archive) {
    const result = spawnSync('tar', ['-xf', downloadPath, '-C', runtimeDir], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Unable to extract the Windows runtime archive');
    fs.rmSync(downloadPath, { force: true });
  } else {
    fs.renameSync(downloadPath, executablePath);
  }

  fs.chmodSync(executablePath, 0o700);
  fs.writeFileSync(markerPath, `${VERSION}:${targetKey}\n`);
  console.log(`FrankenPHP ${VERSION} ready: ${executablePath}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
