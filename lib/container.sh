#!/usr/bin/env bash
# Copyright (c) 2023-present, Manticore Software LTD (https:#manticoresearch.com)
# All rights reserved
#
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# ! We are handling exit codes so we cannot use set -e here

# Detect proper path to the binary to run
ARCH=$(arch)
bin_path="$PROJECT_DIR/bin/${ARCH/arm64/aarch64}"

container_exec() {
	image=$1
	command=$2
	directory=${3:-tests}
	interactive=${4:-}
	if [ ! -d "$directory" ]; then
		>&2 echo "Directory with tests does not exist: $directory"
		return 1
	fi

	if [ -z "$image" ] || [ -z "$command" ]; then
		>&2 echo 'Usage: container_exec "image" "command"'
		return 1
	fi

	# Merge base of patterns
	temp_file=$(mktemp)
	cat "$PROJECT_DIR/.clt/patterns" > "$temp_file"

	# Merge project .patterns to extend original
	if [ -f ".clt/patterns" ]; then
		cat .clt/patterns >> "$temp_file"
	fi

	flag=
	if [ -n "$interactive" ]; then
		flag="-i"
	fi
	process=$(echo docker run \
		-e CLT_DEBUG="$CLT_DEBUG" \
		-e CLT_DIFF_INLINE="$CLT_DIFF_INLINE" \
		-v \"$bin_path/rec:/usr/bin/clt-rec\" \
		-v \"$bin_path/cmp:/usr/bin/clt-cmp\" \
		-v \"$PWD/$directory:$DOCKER_PROJECT_DIR/$directory\" \
		-v \"$PWD/.clt:$DOCKER_PROJECT_DIR/.clt\" \
		-v \"$temp_file:$DOCKER_PROJECT_DIR/.clt/patterns\" \
		-w \"$DOCKER_PROJECT_DIR\" \
		$RUN_ARGS \
		--entrypoint /bin/bash \
		--rm $flag -t \"$image\" \
		-i -c \"$command\")

	if [ -n "$interactive" ]; then
		eval "$process"
		exit_code=$?
	else
		eval "$process" & pid=$!

		trap "kill -s INT '$pid'; exit 130" SIGINT
		trap "kill -s TERM '$pid'; exit 143" SIGTERM
		wait "$pid"
		exit_code=$?

		trap - SIGINT SIGTERM
	fi

	# Clean up temp file
	rm -f "$temp_file"

	return $exit_code
}

