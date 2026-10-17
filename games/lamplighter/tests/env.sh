# env.sh -- where the compiler and the ROMs are when this checkout is a git
# worktree (../zxbasic and ../caprice32 are siblings of the main working tree)
common=$(cd "$(git rev-parse --git-common-dir)" && pwd)/..
: "${ZXBASIC:=$common/../zxbasic}"
: "${CPC_ROM_DIR:=$common/../caprice32/rom}"
export ZXBASIC CPC_ROM_DIR
# the Plus tests run on the patched Caprice32 and CPCEC built in the main
# working tree (tools/caprice32/work, tools/cpcec/work: make cap32 / cpcec)
: "${CAP32:=$common/tools/caprice32/work/src/cap32}"
: "${CPCEC:=$common/tools/cpcec/work/cpcec}"
export CAP32 CPCEC
