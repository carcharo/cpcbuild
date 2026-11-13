import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const vendor = (p) => fileURLToPath(new URL(`./vendor/cpcbas/dist/src/${p}`, import.meta.url));
// testTimeout: a few tests run whole conversions (img2cpc parity, the Arkos pipeline) and take several
// seconds when the machine is busy; 5 s (the default) made them flaky under load.
// alias: the compiler comes from vendor/cpcbas (scripts/link-cpcbas.mjs); the longer name first.
export default defineConfig({
  resolve: { alias: [
    { find: /^@cpcbuild\/cpcbas\/node$/, replacement: vendor('node/index.js') },
    { find: /^@cpcbuild\/cpcbas$/, replacement: vendor('index.js') },
  ] },
  test: { include: ['src/**/*.test.ts'], passWithNoTests: true, testTimeout: 30000 },
});
