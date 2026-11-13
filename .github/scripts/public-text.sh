#!/usr/bin/env bash
# Public-text guard: this repository is public, so its tracked text must not name what is not.
#
#   public-text.sh            check; exit 1 on a hit that is neither allowed nor on the expected-failure list
#   public-text.sh --list     print the current hits in the list's format (to regenerate public-text.expected)
#   PUBLIC_TEXT_STRICT=1 ...  ignore the expected-failure list (the target state: the list is empty)
#
# Rules (case-insensitive, `git grep` over tracked text files; a file is named once per rule, not per line):
#   boriel   `Boriel` only in the credit paragraphs (README.md, the Studio README, LICENSES/, SOURCES.txt), the
#            changelog, and packaging/make-sdk.py (it writes the credit text of the SDK's SOURCES.txt and LICENSES/)
#   zxb      `zxbc`, `zxbasic` and `ZXBASIC` only in the changelog and the 0.1.x migration note
#   private  `cpcbuild-dev` nowhere
#   nextbuild  `NextBuild` nowhere
#
# public-text.expected lists the hits that exist today ("<rule> <path>" per line) and shrinks to nothing as the
# text is cleaned: a hit that is not on it fails; an entry that no longer hits only warns (delete it).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

here=.github/scripts
expected=$here/public-text.expected

# allow-lists: bash `case` patterns, one rule each
allow_boriel='README.md|vscode/cpcbuild-studio/README.md|LICENSES/*|SOURCES.txt|CHANGELOG.md|packaging/make-sdk.py'
allow_zxb='CHANGELOG.md|docs/migrating-from-0.1.md'
allow_private=''
allow_nextbuild=''

hits=$(mktemp)
trap 'rm -f "$hits" "$hits.new" "$hits.stale" "$hits.exp"' EXIT

allowed() { # path allow-patterns("|"-separated globs)
  local f=$1 pat
  local IFS='|'
  for pat in $2; do
    # shellcheck disable=SC2053
    [[ $f == $pat ]] && return 0
  done
  return 1
}

scan() { # rule regex allow-pattern
  local rule=$1 regex=$2 allow=$3 f
  git grep -IilE "$regex" -- . ":(exclude)$here/public-text.sh" ":(exclude)$expected" | while IFS= read -r f; do
    if allowed "$f" "$allow"; then continue; fi
    printf '%s %s\n' "$rule" "$f"
  done
}

{
  scan boriel 'boriel' "$allow_boriel"
  scan zxb 'zxbc|zxbasic' "$allow_zxb"
  scan private 'cpcbuild-dev' "$allow_private"
  scan nextbuild 'nextbuild' "$allow_nextbuild"
} | LC_ALL=C sort > "$hits"

if [ "${1:-}" = "--list" ]; then cat "$hits"; exit 0; fi

if [ "${PUBLIC_TEXT_STRICT:-}" = 1 ] || [ ! -f "$expected" ]; then : > "$hits.exp"
else grep -v '^#' "$expected" | grep -v '^$' | LC_ALL=C sort > "$hits.exp" || true; fi

LC_ALL=C comm -23 "$hits" "$hits.exp" > "$hits.new"
LC_ALL=C comm -13 "$hits" "$hits.exp" > "$hits.stale"

if [ -s "$hits.stale" ]; then
  echo "public-text: these expected hits are gone; delete them from $expected:"
  sed 's/^/  /' "$hits.stale"
fi
if [ -s "$hits.new" ]; then
  echo "public-text: FAILED. Text this public repository must not contain:" >&2
  while read -r rule path; do
    echo "  [$rule] $path" >&2
    case $rule in
      boriel) re=boriel ;; zxb) re='zxbc|zxbasic' ;; private) re=cpcbuild-dev ;; *) re=nextbuild ;;
    esac
    git grep -InE -i -m2 "$re" -- "$path" | sed 's/^/      /' >&2 || true
  done < "$hits.new"
  exit 1
fi
echo "public-text: ok ($(wc -l < "$hits" | tr -d ' ') hit(s), all on the expected list or allowed)"
