#!/usr/bin/env bash

set -euo pipefail

: "${CLT_TIMINGS_TESTS:?CLT_TIMINGS_TESTS is required}"
: "${CLT_TIMINGS_RESULTS_PATH:?CLT_TIMINGS_RESULTS_PATH is required}"

hash_content() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	else
		shasum -a 256 "$1" | cut -d' ' -f1
	fi
}

mkdir -p "$(dirname "$CLT_TIMINGS_RESULTS_PATH")"
temporary="$(mktemp "${CLT_TIMINGS_RESULTS_PATH}.XXXXXX")"
trap 'rm -f "$temporary"' EXIT

while IFS= read -r test; do
	[[ -n "$test" ]] || continue
	identifier="$(hash_content "$test")"
	rep="${test%.rec}.rep"
	duration_ms=
	if [[ -f "$rep" ]]; then
		while IFS= read -r line; do
			if [[ "$line" =~ ^Time\ taken\ for\ test:[[:space:]]*([0-9]+)ms[[:space:]]*$ ]]; then
				duration_ms="${BASH_REMATCH[1]}"
				break
			fi
		done < "$rep"
	fi
	[[ "$duration_ms" =~ ^[1-9][0-9]*$ ]] || continue
	printf '%s\t%s\n' "$identifier" "$duration_ms" >> "$temporary"
done < "$CLT_TIMINGS_TESTS"

mv "$temporary" "$CLT_TIMINGS_RESULTS_PATH"
printf 'Collected timing measurements for %s successful tests\n' "$(awk 'END { print NR + 0 }' "$CLT_TIMINGS_RESULTS_PATH")"
