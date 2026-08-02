throw new Error(
  'slang-loader is a build-time, Node-only package: it embeds a ~24 MB Slang compiler and must ' +
    'never reach a client bundle. Import it from your build config (vite.config.ts) rather than ' +
    'from application code, and import the compiled WGSL from your `.slang` file instead.',
);

export {};
