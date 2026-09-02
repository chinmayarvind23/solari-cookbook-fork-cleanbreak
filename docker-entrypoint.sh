#!/bin/sh
set -eu

mkdir -p /app/artifacts
chown nextjs:nodejs /app/artifacts

exec gosu nextjs "$@"
