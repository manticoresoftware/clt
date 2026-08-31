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
printf 'recording\n' > "$tmpdir/tests/slow.rec"
cp "$tmpdir/tests/slow.rec" "$tmpdir/tests/duplicate.rec"
printf 'broken recording\n' > "$tmpdir/tests/broken.rec"
printf 'Time taken for test: 2000ms\n' > "$tmpdir/tests/slow.rep"
printf 'Time taken for test: 2000ms\n' > "$tmpdir/tests/duplicate.rep"
printf 'Time taken for test: 2000ms\n' > "$tmpdir/tests/broken.rep"
printf 'tests/slow.rec\ntests/duplicate.rec\n' > "$tmpdir/successful.tests"

slow_hash="$(hash_content 'tests/slow.rec')"
broken_hash="$(hash_content 'tests/broken.rec')"
(
	cd "$tmpdir"
	CLT_TIMINGS_TESTS="$tmpdir/successful.tests" \
	CLT_TIMINGS_RESULTS_PATH="$tmpdir/worker.results" \
	bash "$root/scripts/update-timings.sh"
)
assert_eq "$(grep -Fxc "$slow_hash"$'\t2000' "$tmpdir/worker.results")" "2" "each successful root-action test must be exported"
assert_eq "$(grep -Fc "$broken_hash" "$tmpdir/worker.results" || true)" "0" "tests absent from the successful list must not be exported"

printf 'Time taken for test: 3000ms\n' > "$tmpdir/tests/slow.rep"
printf 'tests/slow.rec\n' > "$tmpdir/successful.tests"
(
	cd "$tmpdir"
	CLT_TIMINGS_TESTS="$tmpdir/successful.tests" \
	CLT_TIMINGS_RESULTS_PATH="$tmpdir/worker.results" \
	bash "$root/scripts/update-timings.sh"
)
assert_eq "$(grep -Fxc "$slow_hash"$'\t3000' "$tmpdir/worker.results")" "1" "a worker result must contain only its current execution"
printf 'Timing collection tests passed\n'
