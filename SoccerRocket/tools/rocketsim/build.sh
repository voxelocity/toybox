#!/usr/bin/env bash
# Builds RocketSim + the rs_oracle driver into tools/rocketsim/.build/ and
# exports SoccerRocket's arena collision mesh for it.
#
#   tools/rocketsim/build.sh            # clone RocketSim if needed, build, export mesh
#   RS_DIR=/path/to/RocketSim tools/rocketsim/build.sh
#
# Re-running is incremental (ninja). The mesh is re-exported every run because
# it is cheap and must track public/js/physics/arena.js.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RS_DIR="${RS_DIR:-$HERE/.rocketsim}"
BUILD="$HERE/.build"
RS_REPO="${RS_REPO:-https://github.com/ZealanL/RocketSim}"

if [ ! -f "$RS_DIR/src/RocketSim.h" ]; then
  echo "[rocketsim] cloning $RS_REPO -> $RS_DIR"
  git clone --depth 1 "$RS_REPO" "$RS_DIR"
fi

GEN=()
if command -v ninja >/dev/null 2>&1; then GEN=(-G Ninja); fi

if [ ! -f "$BUILD/CMakeCache.txt" ] || [ "$(cat "$BUILD/.rs_dir" 2>/dev/null)" != "$RS_DIR" ]; then
  rm -rf "$BUILD/CMakeCache.txt" "$BUILD/CMakeFiles"
  cmake -S "$HERE" -B "$BUILD" "${GEN[@]}" -DCMAKE_BUILD_TYPE=Release -DRS_DIR="$RS_DIR" >/dev/null
  echo "$RS_DIR" > "$BUILD/.rs_dir"
fi
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"
cmake --build "$BUILD" --target rs_oracle -j "$JOBS"

node "$HERE/export-cmf.mjs" "$BUILD/meshes/soccar"
echo "[rocketsim] ready: $BUILD/rs_oracle"
