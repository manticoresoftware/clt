#!/usr/bin/env bash

set -euo pipefail

: "${CLT_TIMINGS_PATH:?CLT_TIMINGS_PATH is required}"
: "${CLT_TIMINGS_ARTIFACTS:?CLT_TIMINGS_ARTIFACTS is required}"

mkdir -p "$(dirname "$CLT_TIMINGS_PATH")"
temporary="$(mktemp "${CLT_TIMINGS_PATH}.XXXXXX")"
trap 'rm -f "$temporary"' EXIT

inputs=()
[[ -f "$CLT_TIMINGS_PATH" ]] && inputs+=("$CLT_TIMINGS_PATH")
while IFS= read -r file; do
	inputs+=("$file")
done < <(find "$CLT_TIMINGS_ARTIFACTS" -type f -name '*.tsv' | sort)

if (( ${#inputs[@]} == 0 )); then
	: > "$temporary"
else
	awk -F '\t' 'length($1) == 64 && $1 ~ /^[0-9a-f]+$/ && $2 ~ /^[1-9][0-9]*$/ { duration[$1] = $2 } END { for (identifier in duration) print identifier "\t" duration[identifier] }' "${inputs[@]}" | sort > "$temporary"
fi
mv "$temporary" "$CLT_TIMINGS_PATH"
printf 'Collected timing measurements from %s jobs\n' "$(find "$CLT_TIMINGS_ARTIFACTS" -type f -name '*.tsv' | wc -l | tr -d ' ')"
