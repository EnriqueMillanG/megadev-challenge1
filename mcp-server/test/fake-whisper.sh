#!/bin/bash
# stand-in for whisper-cli in tests: writes fixed JSON to the -of path
while [ $# -gt 0 ]; do [ "$1" = "-of" ] && OUT="$2"; shift; done
cat > "$OUT.json" <<J
{"result":{"language":"en"},"transcription":[{"offsets":{"from":0,"to":2500},"text":" Hello there."},{"offsets":{"from":2500,"to":5100},"text":" Second line."}]}
J
