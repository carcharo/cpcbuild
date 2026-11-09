import { defineConfig } from 'vitest/config';
// testTimeout: a few tests run whole conversions (img2cpc parity, the Arkos pipeline) and take several
// seconds when the machine is busy; 5 s (the default) made them flaky under load.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], passWithNoTests: true, testTimeout: 30000 } });
