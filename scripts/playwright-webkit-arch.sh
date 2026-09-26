#!/usr/bin/env bash
# Playwright's WebKit is built for Ubuntu. On Arch, after `pacman -S flite libxml2-legacy libbacktrace`
# and `yay -S icu74`, it still lacks libjxl 0.8 and six flite voices; this links them to what Arch has.
# The links are resolved lazily, so only JPEG XL decoding and those speech voices would fail, and no
# test uses either. Rerun after every `playwright install` that downloads a new WebKit.
set -euo pipefail

cache="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
missing=$(pacman -T flite libxml2-legacy libbacktrace icu74 || true)
if [ -n "$missing" ]; then
  echo "Install first: sudo pacman -S --needed flite libxml2-legacy libbacktrace && yay -S icu74" >&2
  echo "Missing: $missing" >&2
  exit 1
fi

jxl=$(ls /usr/lib/libjxl.so.0.* | grep -E 'libjxl\.so\.0\.[0-9]+$' | sort -V | tail -1)
voice=/usr/lib/libflite_cmu_us_slt.so.1

shopt -s nullglob
dirs=("$cache"/webkit-*/minibrowser-*/lib)
if [ ${#dirs[@]} -eq 0 ]; then
  echo "No Playwright WebKit under $cache; run: bunx playwright install webkit" >&2
  exit 1
fi

for dir in "${dirs[@]}"; do
  [ -e "$dir/libjxl.so.0.8" ] || ln -s "$jxl" "$dir/libjxl.so.0.8"
  for name in cmu_grapheme_lang cmu_grapheme_lex cmu_time_awb cmu_us_awb cmu_us_kal cmu_us_rms; do
    [ -e "/usr/lib/libflite_$name.so.1" ] || [ -e "$dir/libflite_$name.so.1" ] ||
      ln -s "$voice" "$dir/libflite_$name.so.1"
  done
  echo "linked $dir"
done
