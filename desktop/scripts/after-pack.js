const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function removeExtendedAttribute(attribute, target) {
  try {
    await execFileAsync('xattr', ['-dr', attribute, target]);
  } catch {
    // xattr exits non-zero when the attribute is absent on part of the tree.
  }
}

exports.default = async context => {
  if (context.electronPlatformName !== 'darwin') return;

  // iCloud/File Provider can add signing-breaking metadata while Electron is unpacked.
  await removeExtendedAttribute('com.apple.FinderInfo', context.appOutDir);
  await removeExtendedAttribute('com.apple.ResourceFork', context.appOutDir);
  await removeExtendedAttribute('com.apple.fileprovider.fpfs#P', context.appOutDir);
  await execFileAsync('xattr', ['-cr', context.appOutDir]);
};
