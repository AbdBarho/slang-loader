import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unzipSync } from 'fflate';

import { SLANG_VERSION as version, SLANG_WASM_SHA256 as sha256 } from '../src/compiler/version.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const tag = `v${version}`;
const zipName = `slang-${version}-wasm.zip`;
const zipUrl = `https://github.com/shader-slang/slang/releases/download/${tag}/${zipName}`;
const licenseUrl = `https://raw.githubusercontent.com/shader-slang/slang/${tag}/LICENSE`;
const vendor = join(root, 'vendor');

console.log(`Fetching ${zipUrl}`);
console.log(`Fetching ${licenseUrl}`);
const [zip, license] = await Promise.all([download(zipUrl), download(licenseUrl)]);

const digest = createHash('sha256').update(zip).digest('hex');
if (digest !== sha256) {
  throw new Error(
    `Checksum mismatch for ${zipName}.\n  expected ${sha256}\n  actual   ${digest}\n` +
      `Either the release asset changed, or SLANG_WASM_SHA256 in src/compiler/version.ts is stale.`,
  );
}

rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });

const files = unzipSync(zip);
for (const [name, data] of Object.entries(files)) {
  if (name.endsWith('/')) continue;
  const target = join(vendor, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

writeFileSync(join(vendor, 'SLANG-LICENSE.txt'), license);

console.log(`Wrote ${Object.keys(files).length + 1} files to vendor/ (Slang ${version})`);

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}
