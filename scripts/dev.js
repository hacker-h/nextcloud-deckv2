import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadLocalEnv() {
  const path = resolve(root, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

loadLocalEnv();
process.env.NC_URL ??= process.env.VITE_NC_URL;

const children = new Set();
let shuttingDown = false;
let shutdownCode = 0;

function start(command, args) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit' });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) shutdown(code ?? (signal ? 1 : 0));
    else if (children.size === 0) process.exit(shutdownCode);
  });
  child.on('error', () => {
    children.delete(child);
    if (!shuttingDown) shutdown(1);
  });
  return child;
}

function shutdown(code = 0) {
  shuttingDown = true;
  shutdownCode = code;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(shutdownCode);
  }, 2000).unref();
  if (children.size === 0) process.exit(shutdownCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start(process.execPath, ['server/index.js']);
start(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js')]);
