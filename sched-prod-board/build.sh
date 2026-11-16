#!/bin/bash
# Stamps the build sha (R6) into a copy of app/ under dist/ and uploads it to the public bucket.
set -e
cd "$(dirname "$0")"
SHA=$(git rev-parse HEAD)
rm -rf dist && cp -r app dist
sed -i "s/__BUILD__/$SHA/g" dist/index.html dist/build.js
sed -i "s/__SESSION__/$(cat "${SESSION_FILE:?set SESSION_FILE}")/" dist/config.js
echo "$SHA"
