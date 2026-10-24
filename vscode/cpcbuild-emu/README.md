# CPC Game Studio Emulator

Amstrad CPC 464, 664, 6128 and 6128 Plus emulator for VS Code, in an editor tab. The emulation is
[CPCEC](https://github.com/cpcitor/cpcec) by Cesar Nicolas-Gonzalez compiled to WebAssembly; the page around it
(video, sound, keyboard, the debugger commands) is CPCBuild's.
It is the emulator half of CPC Game Studio and works with the CPC Game Studio extension.

## Use

- **CPC Emulator: Open File...** (Command Palette), or right-click a `.dsk`, `.cpr` or `.sna` file and choose
  **Run in CPC Emulator**.
- Click the screen to give it the keyboard (your keys go to the CPC). **Ctrl+Shift+Esc** returns focus to the
  toolbar. Click **Click for sound** once: browsers allow audio only after a click in the page.
- The toolbar resets the machine and pauses or resumes it. The emulator pauses by itself while its tab is hidden;
  set `cpcbuild.emu.runHidden` to keep it running (hidden pages are throttled by the browser, so it may run slowly).

## For other extensions (API version 1)

The emulator is driven only through VS Code commands (`cpcbuild.emu.version`, `open`, `reset`, `pause`, `resume`,
`step`, `stepOver`, `stepOut`, `state`, `readMemory`, `writeMemory`, `setBreakpoint`, `clearBreakpoint`,
`screenshot`, `close`). The types are in `src/emuApi.ts` of the source archive. Every command resolves; a failure
is `{ error: string }`. When a session pauses, resumes or closes, the command `cpcbuild.emuEvent` is run with
`{ session, event, state }` if some extension registered it.

## Licence and source

GNU General Public License, version 3 or (at your option) any later version (CPCEC is GPLv3; see `LICENSE`).
The `.vsix` contains `source/cpcbuild-emu-source.tar.gz`: the CPCEC source at the pinned commit as fetched, CPCBuild's
patches (`cpcbuild.patch`, `host.patch`), the WebAssembly front end and build scripts, and this extension's source.
The CPC ROMs in `media/roms/` are the firmware images that come with CPCEC (Amstrad, Locomotive Software; distributed
with CPCEC by its author).
Icons: [@vscode/codicons](https://github.com/microsoft/vscode-codicons) (CC BY 4.0 / MIT).
