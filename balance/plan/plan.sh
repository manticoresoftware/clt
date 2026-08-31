#!/usr/bin/env bash

set -euo pipefail

: "${CLT_BALANCE_TESTS:?CLT_BALANCE_TESTS is required}"
: "${CLT_BALANCE_WORKERS:?CLT_BALANCE_WORKERS is required}"
: "${CLT_BALANCE_TIMINGS:?CLT_BALANCE_TIMINGS is required}"
: "${CLT_BALANCE_OUTPUT:?CLT_BALANCE_OUTPUT is required}"

if ! [[ "$CLT_BALANCE_WORKERS" =~ ^[1-9][0-9]*$ ]]; then
	printf 'workers must be a positive integer\n' >&2
	exit 2
fi

hash_content() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	else
		shasum -a 256 "$1" | cut -d' ' -f1
	fi
}

median_samples() {
	tr ',' '\n' <<< "$1" | sort -n | awk '
	{ values[NR] = $1 }
	END {
		if (NR % 2 == 1) print values[(NR + 1) / 2]
		else print int((values[NR / 2] + values[NR / 2 + 1]) / 2)
	}'
}

candidates="$(mktemp)"
queue_dir="$(mktemp -d)"
trap 'rm -f "$candidates"; rm -rf "$queue_dir"' EXIT

while IFS= read -r test; do
	[[ -n "$test" ]] || continue
	recording="${test%.rec}.rec"
	[[ -f "$recording" ]] || continue
	test="${recording%.rec}"
	identifier="$(hash_content "$recording")"
	weight=1000
	if [[ -f "$CLT_BALANCE_TIMINGS" ]]; then
		known_samples="$(awk -F '	' -v identifier="$identifier" '$1 == identifier && $2 ~ /^[1-9][0-9]*(,[1-9][0-9]*)*$/ { value = $2 } END { print value }' "$CLT_BALANCE_TIMINGS")"
		known_weight=""
		[[ -n "$known_samples" ]] && known_weight="$(median_samples "$known_samples")"
		[[ -n "$known_weight" ]] && weight="$known_weight"
	fi
	printf '%012d\t%s\n' "$weight" "$test" >> "$candidates"
done <<< "$CLT_BALANCE_TESTS"

if [[ ! -s "$candidates" ]]; then
	printf 'matrix={"chunk":[]}\n' >> "$CLT_BALANCE_OUTPUT"
	exit 0
fi

loads=()
for ((worker = 0; worker < CLT_BALANCE_WORKERS; worker++)); do
	loads[worker]=0
	: > "$queue_dir/$worker.tests"
done

while IFS=$'\t' read -r weight test; do
	least_loaded=0
	for ((worker = 1; worker < CLT_BALANCE_WORKERS; worker++)); do
		if (( loads[worker] < loads[least_loaded] )); then
			least_loaded=$worker
		fi
	done
	printf '%s\n' "$test" >> "$queue_dir/$least_loaded.tests"
	loads[least_loaded]=$((loads[least_loaded] + 10#$weight))
done < <(sort -rn "$candidates" | awk -F '\t' '!seen[$2]++')

chunks='[]'
for ((worker = 0; worker < CLT_BALANCE_WORKERS; worker++)); do
	tests="$(jq -Rsc 'split("\n") | map(select(length > 0))' < "$queue_dir/$worker.tests")"
	chunk="$(jq -cn --argjson id "$worker" --argjson tests "$tests" '{id:$id, tests:$tests}')"
	chunks="$(jq -cn --argjson chunks "$chunks" --argjson chunk "$chunk" '$chunks + [$chunk]')"
done
printf 'matrix=%s\n' "$(jq -cn --argjson chunks "$chunks" '{chunk:$chunks}')" >> "$CLT_BALANCE_OUTPUT"
printf 'Balanced %s CLT tests across %s workers\n' "$(awk 'END { print NR + 0 }' "$candidates")" "$CLT_BALANCE_WORKERS"
