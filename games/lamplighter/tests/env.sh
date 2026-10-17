# env.sh -- where the compiler and the ROMs are when this checkout is a git
# worktree (../zxbasic and ../caprice32 are siblings of the main working tree)
common=$(cd "$(git rev-parse --git-common-dir)" && pwd)/..
: "${ZXBASIC:=$common/../zxbasic}"
: "${CPC_ROM_DIR:=$common/../caprice32/rom}"
export ZXBASIC CPC_ROM_DIR
