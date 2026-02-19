import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = ['server', 'config'];
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs']);
const BLOCKED_PATTERNS = ['VITE_AIRTABLE_API_KEY', 'VITE_AIRTABLE_BASE_ID'];

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
}

function main(): void {
  const files: string[] = [];
  for (const dir of TARGET_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full, files);
  }

  const violations: Array<{ file: string; pattern: string; line: number }> = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const pattern of BLOCKED_PATTERNS) {
        if (line.includes(pattern)) {
          violations.push({
            file: path.relative(ROOT, file),
            pattern,
            line: idx + 1,
          });
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error('Security gate failed: found disallowed env-variable usage in runtime code.');
    for (const v of violations) {
      console.error(`- ${v.file}:${v.line} contains ${v.pattern}`);
    }
    process.exit(1);
  }

  console.info('Security gate passed: no disallowed VITE Airtable env usage found.');
}

main();
