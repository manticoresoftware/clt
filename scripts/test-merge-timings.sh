#!/usr/bin/env bash

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

first='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
second='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
mkdir -p "$tmpdir/artifacts/first" "$tmpdir/artifacts/second"
printf '%s\t1000\n' "$first" > "$tmpdir/timings.tsv"
printf '%s\t2000\n' "$first" > "$tmpdir/artifacts/first/timings.tsv"
printf '%s\t3000\ninvalid\trow\n' "$second" > "$tmpdir/artifacts/second/timings.tsv"
CLT_TIMINGS_PATH="$tmpdir/timings.tsv" CLT_TIMINGS_ARTIFACTS="$tmpdir/artifacts" bash "$root/balance/merge-results/merge-results.sh"
[[ "$(grep -Fxc "$first"$'\t2000' "$tmpdir/timings.tsv")" == 1 ]]
[[ "$(grep -Fxc "$second"$'\t3000' "$tmpdir/timings.tsv")" == 1 ]]
[[ "$(wc -l < "$tmpdir/timings.tsv" | tr -d ' ')" == 2 ]]
printf 'Timing merge tests passed\n'
