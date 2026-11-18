import assert from 'node:assert/strict';
import test from 'node:test';
import { stripBuildPaths } from './sanitize-runtime.mjs';

test('removes the build directory from generated comments without changing JavaScript', () => {
  const input = '//#region \\0dsh-devtools:css:/tmp/dsh-source/node_modules/a.css\nexport const value = 7;\n';
  assert.equal(stripBuildPaths(input, '/tmp/dsh-source'),
    '//#region \\0dsh-devtools:css:dsh-source/node_modules/a.css\nexport const value = 7;\n');
});

test('refuses to rewrite a path used by executable code', () => {
  assert.throws(() => stripBuildPaths('export const file = "/tmp/dsh-source/file";\n', '/tmp/dsh-source'),
    /outside generated region comments/);
});

test('leaves unrelated generated code unchanged', () => {
  const input = '//#region upstream\nexport const value = 7;\n';
  assert.equal(stripBuildPaths(input, '/tmp/dsh-source'), input);
});
