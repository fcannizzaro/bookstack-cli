import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/cli.ts'],
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: true,
    outExtensions: () => ({ js: '.js' }),
  },
  test: { include: ['test/**/*.test.ts'] },
  lint: { ignorePatterns: ['dist/**'] },
  fmt: { singleQuote: true, ignorePatterns: ['dist/**', 'pnpm-lock.yaml'] },
});
