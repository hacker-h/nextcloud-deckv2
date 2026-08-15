import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shippedRoots = ['server', 'shared'];

function sourceFiles(dir) {
  return readdirSync(join(repoRoot, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js'))
    .map((entry) => join(entry.parentPath, entry.name));
}

function relativeImports(file) {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/(?:^|\s)(?:import|export)[^'"\n]*from\s*['"](\.[^'"]+)['"]/g)].map((match) => match[1]);
}

describe('runtime module graph', () => {
  it('is reachable from the paths the production image copies', () => {
    const escaping = [];
    for (const root of shippedRoots) {
      for (const file of sourceFiles(root)) {
        for (const specifier of relativeImports(file)) {
          const target = relative(repoRoot, resolve(dirname(file), specifier));
          if (!shippedRoots.some((shipped) => target.startsWith(`${shipped}/`))) {
            escaping.push(`${relative(repoRoot, file)} -> ${specifier}`);
          }
        }
      }
    }
    expect(escaping).toEqual([]);
  });

  it('copies every shipped root into the image', () => {
    const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
    for (const root of shippedRoots) {
      expect(dockerfile).toContain(`COPY --from=build /app/${root} ./${root}`);
    }
  });
});
