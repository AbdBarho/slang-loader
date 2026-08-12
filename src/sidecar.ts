import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';

import { MARKER } from './typegen.ts';

const NODE_MODULES = /(^|[\\/])node_modules[\\/]/;

export function sidecarPath(shader: string): string {
  return `${shader}.d.ts`;
}

// Takes the query-stripped path: passthrough queries never reach the transform, but Vite's own (?used) do.
export function isWritable(path: string): boolean {
  if (path.startsWith('\0') || NODE_MODULES.test(path)) return false;

  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// Refuses to clobber a declaration this plugin did not write, mirroring the marker gate on removeSidecar.
export function writeSidecar(shader: string, contents: string): boolean {
  const path = sidecarPath(shader);
  const existing = read(path);
  if (existing === contents) return true;
  if (existing !== null && !existing.startsWith(MARKER)) return false;

  const staging = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(staging, contents);
    renameSync(staging, path);
  } catch (error) {
    try {
      unlinkSync(staging);
    } catch {
      // the staging file may never have been created
    }
    throw error;
  }

  return true;
}

// A watcher reporting a delete is not proof: atomic saves and branch switches surface as unlink then add.
export function removeSidecar(shader: string): boolean {
  const path = sidecarPath(shader);
  if (exists(shader)) return false;

  try {
    if (!read(path)?.startsWith(MARKER)) return false;
  } catch {
    return false;
  }

  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
