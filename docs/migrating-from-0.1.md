# Coming from CPCBuild 0.1.x

CPCBuild 0.1.x compiled programs with a fork of Boriel BASIC. CPCBuild 0.2.0 compiles CPC BASIC with `cpcbas`, a new
compiler that lives in its own repository, [carcharo/cpcbas](https://github.com/carcharo/cpcbas). This page is for
people with a 0.1.x project. After reading it you know what changed, how to convert the project, and how to keep
building it the old way if you have to.

## What changed

| | 0.1.x | 0.2.0 |
|---|---|---|
| Language | Boriel BASIC (`--arch cpc`) | CPC BASIC: Locomotive BASIC 1.1 with typed `SUB` and `FUNCTION`, arrays, inline Z80 and includes |
| Compiler | `zxbc`, a Python program (downloaded by Studio, or from a checkout of the fork) | `cpcbas`, TypeScript, built into CPC Game Studio; the command line needs Node.js 22 |
| Python | not needed for normal use; Python and Poetry to run the compiler from a checkout | not needed to build; the image converter is built into Studio, and the `tools/` scripts need Python 3 |
| Targets | CPC, CPC Plus, ZX Spectrum | CPC and CPC Plus only |
| SDK | one archive per platform | one `.zip` for every platform |
| Studio setting for the compiler | `cpcbuild.zxbc.command`, `.cwd`, `.args` | `cpcbuild.compiler.args` (the `cpcbas` options) |

The library (`#include <cpcbuild.bas>` and the files below it) keeps its calls. A few parameters have new names
(calls are positional, so no call changes), `Mode n` is the statement `MODE n`, and `WaitVsync` is the statement `FRAME`.
[docs/library.md](library.md) is the reference for the 0.2.0 library, including a list of the 0.1.x calls that are
gone ([9.12](library.md#912-calls-the-01x-library-had)).

## Convert the project

In CPC Game Studio, open the project folder and run **CPC Game Studio: Convert Project to CPC BASIC**. It writes nothing until you
have seen the report and said yes:

1. It asks whether this is a 0.1.x (Boriel BASIC) project. Answer **Yes** for a project built with 0.1.x.
2. It opens a report: the files that would change, and one line for everything it could not rewrite by itself.
   Findings numbered W720 to W725 stop the build until you fix them by hand; the others (W726 to W739) are places where
   valid CPC BASIC means something different from what the old program meant, such as a comparison that is now -1
   when true. Read them once.
3. It asks you to confirm the write, and then whether to remove the Spectrum targets from `cpcbuild.json`.
   (A project with only Spectrum targets keeps them.)

From a terminal, the same translator is `cpcbas migrate`:

```sh
cpcbas migrate --check PATH...             # change nothing; exit 1 if a file would change or a must-fix finding exists
cpcbas migrate --from boriel -o OUT PATH...  # write the translated project into OUT
```

The SDK has it as `node bin/cpcbas.mjs migrate --help`. Every rule, with its code, is in the compiler's
[migration rules](https://github.com/carcharo/cpcbas/blob/main/docs/migrate.md) (`docs/migrate.md` in the SDK).

Commit your project before you convert it: the conversion rewrites files in place. Run it once on the original files,
with the answer **Yes**; running it again on the result changes nothing.

## What it does not change for you

- **Spectrum targets.** A `cpcbuild.json` with a target whose `arch` is `zx48k`, or whose `package` is `tap`, is an
  error in 0.2.0. Convert offers to remove them. The Spectrum builds, the Spectrum sprite library and `--spectrum` in
  `img2cpc.py` are gone.
- **The old compiler setting.** If your workspace sets `cpcbuild.zxbc.args`, Studio shows a message once, with the
  `cpcbuild.compiler.args` that matches it and the options that have no equivalent. `cpcbuild.zxbc.command`,
  `cpcbuild.zxbc.cwd` and the Spectrum emulator settings are not read any more.
- **Behaviour that differs from Boriel BASIC.** `AND`, `OR` and `NOT` are bitwise, a comparison is -1 when it is true,
  `PRINT` puts a sign position before a number and a space after it, `STR$` keeps the leading space, `INKEY$` returns
  the next key from the buffer rather than the key held now, and unsuffixed variables are `INTEGER`. The review
  findings point at each place where your code depends on one of these.
- **Hex numbers.** `$FF` is `&FF`, and `%0101` is `&X0101`, outside `ASM` blocks. Convert rewrites them.

## Keep building with 0.1.x

Nothing is withdrawn. If a project needs the Spectrum targets, or you want the old compiler for any other reason:

- The 0.1.2 release is on the [Releases page](https://github.com/carcharo/cpcbuild/releases) with its SDK folders and
  `.vsix` files, and the repository tag is [`v0.1.2`](https://github.com/carcharo/cpcbuild/tree/v0.1.2).
- The compiler fork it builds with is [carcharo/zxbasic](https://github.com/carcharo/zxbasic), branch `cpc-arch`.
