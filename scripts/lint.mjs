#!/usr/bin/env node

import { readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(import.meta.dirname, '..');
const sourceRoots = ['app', 'scripts'];
const excludedDirectories = new Set(['node_modules', 'vendor']);
const sourceExtensions = new Set(['.js', '.mjs']);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === 'config.js') continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...await collectSourceFiles(absolutePath));
      continue;
    }
    if (sourceExtensions.has(extname(entry.name))) files.push(absolutePath);
  }

  return files;
}

const files = (await Promise.all(
  sourceRoots.map(directory => collectSourceFiles(join(root, directory)))
)).flat();

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `Syntaxe invalide : ${relative(root, file)}\n`);
    process.exit(1);
  }
}

console.log(`${files.length} fichiers JavaScript vérifiés.`);
