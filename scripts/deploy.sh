#!/bin/bash

set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

cargo build --release
ssh twopc@phi.ts doas systemctl stop twopc.service
scp target/release/2pc-server twopc@phi:/home/twopc/
ssh twopc@phi.ts doas systemctl start twopc.service
