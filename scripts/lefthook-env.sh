if [ -z "${LEFTHOOK_BIN:-}" ] && [ -x "node_modules/.bin/lefthook" ]; then
  export LEFTHOOK_BIN="$PWD/node_modules/.bin/lefthook"
fi
