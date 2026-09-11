// Unit and component tests. Playwright lives in e2e/ and is NOT run from here --
// `test.exclude` keeps the two runners apart, because a .spec.ts written against
// Playwright's `test`/`expect` would otherwise be collected by vitest and fail with
// an error about the wrong runner rather than about the code.
//
//   npm test          once, no browser -- the per-commit gate
//   npm run test:watch
//   npm run test:e2e  Playwright, needs the whole stack up (see e2e/README.md)

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // No @vitejs/plugin-react. It exists for Fast Refresh, which a test run never uses,
  // and its current major needs a newer vite than vitest ships -- installing both put
  // two copies of vite in the tree, which is a type error in this file and a
  // resolution failure at runtime. esbuild does the only part that matters:
  //
  // the app's .jsx files never import React, because Next compiles them with the
  // automatic runtime. Without this line vite falls back to the classic transform and
  // every component dies on "React is not defined" at its first JSX node.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // Mirrors the `@/*` -> `./*` mapping in tsconfig.json. Declared by hand rather
      // than via a tsconfig-paths plugin: there is exactly one alias, and a second
      // dependency to read a one-line mapping is not worth it.
      '@': dirname(fileURLToPath(import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
    // Explicit imports from 'vitest' in every test file instead. Globals would need a
    // matching "types" entry in tsconfig, and the repo type-checks its tests.
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
