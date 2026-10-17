# UI screenshot harness

Real VS Code (test-electron) with Studio and cpcbuild-emu loaded; host.ts (extension host) opens each screen, switches
theme and sizes, run.ts (driver) takes DevTools screenshots via puppeteer-core on --remote-debugging-port.

    npm run build && npm run build:test
    UI_SHOTS_PUPPETEER=<dir containing node_modules/puppeteer-core> UI_SHOTS_OUT=<dir> node out/test/ui-shots/run.js

Optional: CPCBUILD_SHOTS_ONLY=name,name  CPCBUILD_SHOTS_THEMES=dark,light  CPCBUILD_SHOTS_LIVE_ONLY=1  UI_SHOTS_LOG=<file>.
Needs the Chromium backgrounding flags (set in run.ts) or the emulator stalls when the window is occluded.
Full run takes about 6 minutes. Do not call terminal.killAll (confirmation dialog blocks).
