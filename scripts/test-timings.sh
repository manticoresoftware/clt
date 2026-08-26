#!/usr/bin/env bash

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

assert_eq() {
	if [[ "$1" != "$2" ]]; then
		printf 'Expected %s, got %s: %s\n' "$2" "$1" "$3" >&2
		exit 1
	fi
}

hash_content() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$tmpdir/$1" | cut -d' ' -f1
	else
		shasum -a 256 "$tmpdir/$1" | cut -d' ' -f1
	fi
}

mkdir -p "$tmpdir/tests"
printf 'slow recording\n' > "$tmpdir/tests/slow.rec"
cp "$tmpdir/tests/slow.rec" "$tmpdir/tests/duplicate.rec"
printf 'broken recording\n' > "$tmpdir/tests/broken.rec"
printf 'tests/slow.rec\ntests/duplicate.rec\n' > "$tmpdir/successful.tests"
printf 'Time taken for test: 1000ms\n' > "$tmpdir/tests/slow.rep"
printf 'Time taken for test: 1000ms\n' > "$tmpdir/tests/duplicate.rep"
printf 'Time taken for test: 2000ms\n' > "$tmpdir/tests/broken.rep"
slow_hash="$(hash_content 'tests/slow.rec')"
assert_eq "$(hash_content 'tests/duplicate.rec')" "$slow_hash" "identical recording content must have the same timing identity"
broken_hash="$(hash_content 'tests/broken.rec')"
printf '%s\t9000\ninvalid\tentry\n' "$slow_hash" > "$tmpdir/timings.tsv"
(
	cd "$tmpdir"
	CLT_TIMINGS_TESTS="$tmpdir/successful.tests" \
	CLT_TIMINGS_PATH="$tmpdir/timings.tsv" \
	bash "$root/scripts/update-timings.sh"
)
assert_eq "$(grep -Fxc "$slow_hash"$'\t1000' "$tmpdir/timings.tsv")" "1" "successful execution should replace the timing estimate"
assert_eq "$(grep -Fc "$broken_hash" "$tmpdir/timings.tsv" || true)" "0" "tests absent from the successful list must not be recorded"
assert_eq "$(grep -Fc $'\t9000' "$tmpdir/timings.tsv" || true)" "0" "replaced estimates must not be retained"
assert_eq "$(grep -Fc 'tests/' "$tmpdir/timings.tsv" || true)" "0" "timing ledger must not contain test paths"
assert_eq "$(wc -l < "$tmpdir/timings.tsv" | tr -d ' ')" "1" "invalid legacy ledger entries must be discarded"
: > "$tmpdir/successful.tests"
(
	cd "$tmpdir"
	CLT_TIMINGS_TESTS="$tmpdir/successful.tests" \
	CLT_TIMINGS_PATH="$tmpdir/timings.tsv" \
	bash "$root/scripts/update-timings.sh"
)
assert_eq "$(grep -Fxc "$slow_hash"$'\t1000' "$tmpdir/timings.tsv")" "1" "a run without successful timings must retain existing estimates"
printf 'changed recording\n' > "$tmpdir/tests/slow.rec"
printf 'Time taken for test: 3000ms\n' > "$tmpdir/tests/slow.rep"
printf 'tests/slow.rec\n' > "$tmpdir/successful.tests"
changed_hash="$(hash_content 'tests/slow.rec')"
(
	cd "$tmpdir"
	CLT_TIMINGS_TESTS="$tmpdir/successful.tests" \
	CLT_TIMINGS_PATH="$tmpdir/timings.tsv" \
	bash "$root/scripts/update-timings.sh"
)
assert_eq "$(grep -Fxc "$changed_hash"$'\t3000' "$tmpdir/timings.tsv")" "1" "changed recordings must receive a fresh timing identity"
assert_eq "$(wc -l < "$tmpdir/timings.tsv" | tr -d ' ')" "2" "changed recordings must not reuse the old timing estimate"
printf 'Timing collection tests passed\n'
