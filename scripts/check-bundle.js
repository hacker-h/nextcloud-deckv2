import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const src = resolve(root, 'src');
const envLocal = resolve(root, '.env.local');

const findings = [];
const scanned = [];

if (!existsSync(dist)) {
  console.error('dist/ does not exist. Run npm run build first.');
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function relative(path) {
  return path.slice(root.length + 1);
}

function record(kind, file, offset) {
  findings.push({ kind, file: relative(file), offset });
}

function scanFile(file, checks) {
  const text = readFileSync(file, 'utf8');
  scanned.push(relative(file));
  for (const check of checks) {
    if (typeof check.pattern === 'string') {
      let offset = text.indexOf(check.pattern);
      while (offset !== -1) {
        record(check.kind, file, offset);
        offset = text.indexOf(check.pattern, offset + check.pattern.length);
      }
      continue;
    }
    for (const match of text.matchAll(check.pattern)) record(check.kind, file, match.index ?? 0);
  }
}

function loadLocalSecrets() {
  if (!existsSync(envLocal)) return { skipped: true, checks: [] };

  const checks = [];
  const raw = readFileSync(envLocal, 'utf8');
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*(VITE_NC_(?:USER|PASS))\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (value) checks.push({ kind: `${match[1]} literal`, pattern: value });
  }
  return { skipped: false, checks };
}

const envSecrets = loadLocalSecrets();
const bundleChecks = [
  { kind: 'Basic authorization value', pattern: /Basic\s+[A-Za-z0-9+/=]{16,}/g },
  { kind: 'Bearer authorization value', pattern: /Bearer\s+[A-Za-z0-9+/=._-]{16,}/g },
  { kind: 'Nextcloud app-password shape', pattern: /\b[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){4}\b/g },
  ...envSecrets.checks,
];

for (const file of walk(dist)) scanFile(file, bundleChecks);

const sourceFiles = walk(src).filter((file) => statSync(file).isFile());
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(file);
  for (const match of text.matchAll(/VITE_NC_(URL|USER|PASS)/g)) {
    findings.push({ kind: 'client source VITE_NC_* reference', file: rel, offset: match.index ?? 0 });
  }
}

console.log(`Scanned ${scanned.length} dist files:`);
for (const file of scanned) console.log(`- ${file}`);
console.log(`Scanned ${sourceFiles.length} src files for VITE_NC_* references.`);
if (envSecrets.skipped) console.log('.env.local absent; skipped literal VITE_NC_USER/VITE_NC_PASS checks.');
else console.log(`Loaded ${envSecrets.checks.length} literal .env.local secret checks.`);

if (findings.length) {
  console.error(`Found ${findings.length} credential regression(s):`);
  for (const hit of findings) console.error(`- ${hit.kind}: ${hit.file} at offset ${hit.offset}`);
  process.exit(1);
}

console.log('Found 0 credential regressions.');
