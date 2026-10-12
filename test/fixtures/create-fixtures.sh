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

# Create a plain .gz from a single file
gzip -k -f sample/hello.txt
mv sample/hello.txt.gz hello.txt.gz

# Create a plain .bz2 from a single file
bzip2 -k -f sample/hello.txt
mv sample/hello.txt.bz2 hello.txt.bz2

# Create a plain .xz from a single file
xz -k -f sample/hello.txt
mv sample/hello.txt.xz hello.txt.xz

echo "Fixtures created:"
ls -la sample.* hello.txt.*
