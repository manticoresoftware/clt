#!/usr/bin/env bash

set -euo pipefail

: "${CLT_TIMINGS_PATH:?CLT_TIMINGS_PATH is required}"
: "${CLT_TIMINGS_ARTIFACTS:?CLT_TIMINGS_ARTIFACTS is required}"

mkdir -p "$(dirname "$CLT_TIMINGS_PATH")"
temporary="$(mktemp "${CLT_TIMINGS_PATH}.XXXXXX")"
trap 'rm -f "$temporary"' EXIT

baseline=/dev/null
[[ -f "$CLT_TIMINGS_PATH" ]] && baseline="$CLT_TIMINGS_PATH"
artifacts=()
while IFS= read -r file; do
	artifacts+=("$file")
done < <(find "$CLT_TIMINGS_ARTIFACTS" -type f -name '*.tsv' | sort)

awk -F '	' -v baseline_file="$baseline" '
function valid_identifier(identifier) {
	return length(identifier) == 64 && identifier ~ /^[0-9a-f]+$/
}
function valid_samples(samples, values, count, position) {
	count = split(samples, values, ",")
	if (count < 1 || count > 5) return 0
	for (position = 1; position <= count; position++) {
		if (values[position] !~ /^[1-9][0-9]*$/) return 0
	}
	return 1
}
function append_samples(samples, updates, values, update_values, count, update_count, position, first, result) {
	count = split(samples, values, ",")
	update_count = split(updates, update_values, ",")
	for (position = 1; position <= update_count; position++) values[++count] = update_values[position]
	first = count > 5 ? count - 4 : 1
	for (position = first; position <= count; position++) {
		result = result (result == "" ? "" : ",") values[position]
	}
	return result
}
FILENAME == baseline_file {
	if (valid_identifier($1) && valid_samples($2)) timings[$1] = $2
	next
}
valid_identifier($1) && $2 ~ /^[1-9][0-9]*$/ {
	updates[$1] = updates[$1] (updates[$1] == "" ? "" : ",") $2
}
END {
	for (identifier in updates) {
		if (identifier in timings) timings[identifier] = append_samples(timings[identifier], updates[identifier])
		else timings[identifier] = append_samples("", updates[identifier])
	}
	for (identifier in timings) print identifier "	" timings[identifier]
}' "$baseline" "${artifacts[@]}" | sort > "$temporary"
mv "$temporary" "$CLT_TIMINGS_PATH"
printf 'Collected timing measurements from %s jobs\n' "$(find "$CLT_TIMINGS_ARTIFACTS" -type f -name '*.tsv' | wc -l | tr -d ' ')"
