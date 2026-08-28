#!/usr/bin/env bash

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

hash_content() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	else
		shasum -a 256 "$1" | cut -d' ' -f1
	fi
}

assert_eq() {
	[[ "$1" == "$2" ]] || { printf 'Expected %s, got %s: %s\n' "$2" "$1" "$3" >&2; exit 1; }
}

mkdir -p "$tmpdir/tests"
printf 'slow\n' > "$tmpdir/tests/slow.rec"
printf 'medium\n' > "$tmpdir/tests/medium.rec"
printf 'unknown\n' > "$tmpdir/tests/unknown.rec"
printf '%s\t1000,9000,9000\n%s\t5000\n' "$(hash_content "$tmpdir/tests/slow.rec")" "$(hash_content "$tmpdir/tests/medium.rec")" > "$tmpdir/timings.tsv"
(
	cd "$tmpdir"
	CLT_BALANCE_TESTS=$'tests/slow\ntests/medium\ntests/unknown' \
	CLT_BALANCE_WORKERS=2 \
	CLT_BALANCE_TIMINGS="$tmpdir/timings.tsv" \
	CLT_BALANCE_OUTPUT="$tmpdir/output" \
	bash "$root/balance/plan/plan.sh"
)
matrix="$(cut -d= -f2- "$tmpdir/output")"
assert_eq "$(jq '.chunk | length' <<< "$matrix")" 2 "planner must create requested worker count"
assert_eq "$(jq -r '.chunk[0].tests | join("\n")' <<< "$matrix")" tests/slow "planner must use the median of retained timing samples"
assert_eq "$(jq -r '.chunk[1].tests | join("\n")' <<< "$matrix")" $'tests/medium\ntests/unknown' "planner must place remaining work on the least loaded queue"
printf 'Timing planner tests passed\n'
