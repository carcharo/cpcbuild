#!/bin/sh
# Fetch floooh/chips (zlib licence) at a pinned commit into ./chips/.
set -e
SHA=9e88298ce56319953ac7a43213a1120359f7a3a6   # floooh/chips master, 2026-09-26
cd "$(dirname "$0")"
if [ ! -d chips/.git ]; then
    git clone -q https://github.com/floooh/chips chips
fi
if [ "$(git -C chips rev-parse HEAD)" != "$SHA" ]; then
    git -C chips fetch -q origin "$SHA" 2>/dev/null || git -C chips fetch -q origin
    git -C chips checkout -q "$SHA"
fi
cp chips/LICENSE LICENSE.chips
echo "chips at $(git -C chips rev-parse HEAD)"
