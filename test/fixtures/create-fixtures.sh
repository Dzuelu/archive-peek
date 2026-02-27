#!/bin/bash
set -e
cd "$(dirname "$0")"

# Create source content
mkdir -p sample/src
printf 'Hello, World!\n' > sample/hello.txt
printf 'export const version = "1.0.0";\n' > sample/src/index.ts
printf '{"name":"test"}\n' > sample/package.json

# Create archives
tar cf sample.tar -C sample .
tar czf sample.tar.gz -C sample .
tar cjf sample.tar.bz2 -C sample .
tar cJf sample.tar.xz -C sample .
cd sample && zip -r ../sample.zip . && cd ..

# Create a .rar if rar is available (skip otherwise)
if command -v rar &> /dev/null; then
  rar a sample.rar sample/*
fi

echo "Fixtures created:"
ls -la sample.*
