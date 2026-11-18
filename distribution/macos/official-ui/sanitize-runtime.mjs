import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Remove only comment paths; refuse paths in executable code instead of changing behavior. */
export function stripBuildPaths(text, sourceRoot) {
  const prefix = `${sourceRoot}/`;
  const result = text.replace(/^\/\/#region[^\r\n]*$/gm,
    line => line.replaceAll(prefix, 'dsh-source/'));
  if (result.includes(prefix)) throw new Error('Build path appears outside generated region comments');
  return result;
}

/** Normalize a prepared runtime and regenerate its inventory using the upstream implementation. */
export async function sanitizeRuntime(sourceRoot, originalSourceRoot = sourceRoot) {
  const root = resolve(sourceRoot);
  const buildRoot = resolve(originalSourceRoot);
  const runtime = join(root, 'apps/desktop/.desktop-build/targets/mac-x64/dsh');
  const { readDesktopRuntime, verifyDesktopRuntime, writeDesktopRuntime } = await import(
    pathToFileURL(join(root, 'apps/desktop/src/runtime-tree.ts')).href);
  const descriptor = readDesktopRuntime(runtime);
  if (descriptor.release.version !== '0.2.2-rc.4' || descriptor.platform !== 'darwin' || descriptor.arch !== 'x64') {
    throw new Error('Expected the prepared 0.2.2-rc.4 Intel runtime');
  }
  await verifyDesktopRuntime(runtime, descriptor.release.version, { platform: 'darwin', arch: 'x64' });
  const pending = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        const before = readFileSync(path, 'utf8');
        const after = stripBuildPaths(before, buildRoot);
        if (after !== before) pending.push({ path, after });
      }
    }
  }
  visit(join(runtime, 'node_modules/@deepseek-ai/dsh-experimental-inspector/lib/devtools'));
  for (const { path, after } of pending) writeFileSync(path, after);
  writeDesktopRuntime(runtime, descriptor.release, descriptor.sharedPackages.map(entry => entry.name),
    { platform: 'darwin', arch: 'x64' });
  await verifyDesktopRuntime(runtime, descriptor.release.version, { platform: 'darwin', arch: 'x64' });
  console.log(`Normalized generated build-path comments in ${pending.length} files; runtime inventory verified.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: tsx sanitize-runtime.mjs <official-source-directory> [original-build-directory]');
  await sanitizeRuntime(process.argv[2], process.argv[3]);
}
