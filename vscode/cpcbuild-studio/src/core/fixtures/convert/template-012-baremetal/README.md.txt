# My Game

A CPC Game Studio project. Three things to try:

1. Run **CPC Game Studio: Build and Run**: the target is built with `-D CPC_BAREMETAL`.
2. Read the comment at the top of `src/main.bas` for what a bare program cannot call.
3. Open the build report (**CPC Game Studio: Show Build Report**) to see the headroom below the bare limits.

Targets and packaging are in `cpcbuild.json`; the build puts its output in `build/`.
Set `cpcbuild.library.path` (and `cpcbuild.zxbc.command`) in the settings if "CPC Game Studio: Check Environment" reports something missing.
