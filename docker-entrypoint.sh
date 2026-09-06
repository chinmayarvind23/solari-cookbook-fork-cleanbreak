#!/bin/sh
# Prepare the persistent evidence directory, then run the app as its service user.
set -eu

mkdir -p /app/artifacts
chown nextjs:nodejs /app/artifacts

exec gosu nextjs "$@"
