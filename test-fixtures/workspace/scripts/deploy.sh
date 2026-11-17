#!/usr/bin/env bash
# Writes its first argument to bash.out in the current directory (checked by the tests).
set -euo pipefail
echo "Deploying to ${1:-staging}" | tee bash.out
