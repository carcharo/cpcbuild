#!/bin/sh
# build.sh -- zips tools/aseprite/extension/ into cpcbuild.aseprite-extension
# (an Aseprite extension is a zip with package.json at its top level).
# Run from anywhere. The result is not committed (see .gitignore).
set -e
here=$(cd "$(dirname "$0")" && pwd)
out="$here/cpcbuild.aseprite-extension"
rm -f "$out"
(cd "$here/extension" && zip -q -X "$out" package.json cpcbuild.lua cpcbuild_core.lua cpc-firmware-27.gpl)
echo "wrote $out"
