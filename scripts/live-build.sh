#!/bin/bash

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

esbuild --watch assets/app.ts \
    --format=esm \
    --bundle  \
    --sourcemap \
    --target=es2024 \
    --outfile=assets/app.js
