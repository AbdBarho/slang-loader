import { createUnplugin } from 'unplugin';

import { slangFactory, type SlangPluginOptions } from './plugin.ts';

export type { SlangPluginOptions } from './plugin.ts';

export const slang = createUnplugin<SlangPluginOptions | undefined, false>(slangFactory);

export default slang;
