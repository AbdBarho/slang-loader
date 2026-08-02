import { VENDOR_URL } from '../vendor.ts';
import type { SlangWasm } from './types.ts';

type WasmFactory = () => Promise<SlangWasm>;

let booting: Promise<SlangWasm> | undefined;

export function bootWasm(): Promise<SlangWasm> {
  booting ??= boot();
  return booting;
}

async function boot(): Promise<SlangWasm> {
  let factory: WasmFactory;
  try {
    const glue = (await import(VENDOR_URL.href)) as { default: WasmFactory };
    factory = glue.default;
  } catch (cause) {
    throw new Error(
      `slang-loader: could not load the Slang wasm artifact at ${VENDOR_URL.pathname}. ` +
        `If you are working in a clone of this repository, run "npm run fetch-wasm".`,
      { cause },
    );
  }
  return factory();
}
