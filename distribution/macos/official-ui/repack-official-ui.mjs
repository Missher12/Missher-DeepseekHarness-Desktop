import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = '0.2.2-rc.4';
const COMMIT = '3f321d32bfe382212a8ed8785c1d47a5a300aa23';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node repack-official-ui.mjs <official-source-directory> [--prepared]');
  console.log('Requires a frozen dependency install in the clean dsh-v0.2.2-rc.4 checkout.');
  console.log('--prepared reuses the verified official-UI runtime from this exact version.');
  console.log('DSH_BUILD_ORIGINAL_SOURCE_ROOT records the build directory when reusing a copied runtime.');
  process.exit(0);
}
if (args.length < 1 || args.length > 2 || (args[1] !== undefined && args[1] !== '--prepared')) {
  throw new Error('Usage: node repack-official-ui.mjs <official-source-directory> [--prepared]');
}
if (process.platform !== 'darwin' || process.arch !== 'x64') throw new Error('Run on an Intel Mac');
const root = resolve(args[0]);
const desktop = join(root, 'apps/desktop');
const target = join(desktop, '.desktop-build/targets/mac-x64');
const pnpm = join(desktop, 'node_modules/pnpm/bin/pnpm.mjs');
const git = (...values) => execFileSync('git', ['-C', root, ...values], { encoding: 'utf8' }).trim();
if (git('rev-parse', 'HEAD') !== COMMIT || git('status', '--porcelain', '--untracked-files=no') !== '') {
  throw new Error('Use the clean official dsh-v0.2.2-rc.4 checkout; this wrapper is version-specific');
}
if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version !== VERSION) throw new Error('Source version mismatch');
const { localMacOSPackageEnvironment } = await import(pathToFileURL(join(desktop, 'scripts/desktop-package-environment.mjs')).href);
const { desktopBuildCommitEnvironment, readDesktopBuildCommit } = await import(pathToFileURL(join(desktop, 'scripts/desktop-build-commit.mjs')).href);
const { DESKTOP_BUILD_VERSION_ENV } = await import(pathToFileURL(join(desktop, 'scripts/desktop-build-version.mjs')).href);
const env = {
  ...localMacOSPackageEnvironment(process.env),
  ...desktopBuildCommitEnvironment(readDesktopBuildCommit(root)),
  [DESKTOP_BUILD_VERSION_ENV]: VERSION,
  DSH_DESKTOP_TARGET_PLATFORM: 'darwin', DSH_DESKTOP_TARGET_ARCH: 'x64',
  DSH_DESKTOP_MACOS_SKIP_NOTARIZATION: '0', CSC_IDENTITY_AUTO_DISCOVERY: 'false',
};
function run(values, cwd = root) {
  console.log(`STAGE pnpm ${values.join(' ')}`);
  const result = spawnSync(process.execPath, [pnpm, ...values], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (args[1] !== '--prepared') {
  run(['run', 'build:official']);
  run(['run', 'release:pack', '--family', 'dsh', '--out', join(target, 'packed/dsh'), '--concurrency', '4']);
  run(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', join(target, 'packed/dsh')]);
  run(['run', 'release:pack', '--family', 'vendor', '--out', join(target, 'packed/vendor'), '--concurrency', '4']);
  run(['--dir', 'native/system', 'run', 'build:ts']);
  run(['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', join(target, 'packed/landlock')]);
  run(['run', 'prepare:runtime'], desktop);
  run(['run', 'prepare:packages'], desktop);
  run(['run', 'prepare:dsh'], desktop);
}
for (const path of ['runtime/primary-runtime/runtime.json', 'electron/Electron.app', 'dsh/desktop-runtime.json']) {
  if (!existsSync(join(target, path))) throw new Error('Expected the prepared official Intel runtime');
}
const client = JSON.parse(readFileSync(join(root, '.dsh-build/client-build-environment.json'), 'utf8')).environment;
const brand = readFileSync(join(target, 'dsh/node_modules/@deepseek-ai/dsh-client-ui-brand-official/lib/client.js'), 'utf8');
if (client.DSH_CLIENT_BUILD_PROFILE !== 'official' || client.DSH_CLIENT_TITLE !== 'DeepSeek Harness'
  || client.DSH_CLIENT_VERSION !== VERSION || !brand.includes('sidebar.brand.mark') || !brand.includes('sidebar.brand.name')) {
  throw new Error('Official UI preparation is missing');
}
const originalSourceRoot = args[1] === '--prepared' ? process.env.DSH_BUILD_ORIGINAL_SOURCE_ROOT ?? root : root;
run(['exec', 'tsx', join(import.meta.dirname, 'sanitize-runtime.mjs'), root, resolve(originalSourceRoot)]);
run(['exec', 'electron-builder', '--config', 'electron-builder.config.mjs', '--mac', '--x64', '--dir', '--publish', 'never'], desktop);
run(['exec', 'tsx', 'scripts/smoke-packaged-runtime.ts', '--unsigned'], desktop);
console.log(`Packaged ${VERSION} for Intel with official UI and local ad-hoc signing.`);
