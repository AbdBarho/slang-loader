import { readFile } from 'node:fs/promises';

export interface Manifest {
  description: string;
  types: string;
  exports: Record<string, Record<string, string> | string>;
  files: string[];
}

export const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as Manifest;

const NOT_A_BUNDLER = ['.', './unplugin', './module', './package.json'];

export const BUNDLERS = Object.keys(pkg.exports)
  .filter(name => !NOT_A_BUNDLER.includes(name))
  .map(name => name.slice(2));

export const APPLY_ONLY = ['webpack', 'rspack'];

export const NOT_CONSTRUCTIBLE_UNDER_NODE = ['bun'];

export function compute(size: number): string {
  return `[shader("compute")][numthreads(${size},1,1)]\nvoid main(uint3 t : SV_DispatchThreadID) { }`;
}
