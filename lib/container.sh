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

set -e

# Detect proper path to the binary to run
ARCH=$(arch)
bin_path="$PROJECT_DIR/bin/${ARCH/arm64/aarch64}"

container_exec() {
	image=$1
	command=$2
	directory=${3:-tests}
	interactive=${4:-}
	if [ ! -d "$directory" ]; then
		>&2 echo "Directory with tests does not exist: $directory" && exit 1
	fi

	if [ -z "$image" ] || [ -z "$command" ]; then
		>&2 echo 'Usage: container_exec "image" "command"' && exit 1
	fi

	# Merge base of patterns
	temp_file=$(mktemp)
	cat "$PROJECT_DIR/.patterns" > "$temp_file"

	# Merge project .patterns to extend original
	if [ -f ".patterns" ]; then
		cat .patterns >> "$temp_file"
	fi

	flag=
	if [ -n "$interactive" ]; then
		flag="-i"
	fi
	process=$(echo docker run \
		-v \"$bin_path/rec:/usr/bin/clt-rec\" \
		-v \"$bin_path/cmp:/usr/bin/clt-cmp\" \
		-v \"$PWD/$directory:$DOCKER_PROJECT_DIR/$directory\" \
		-v \"$temp_file:$DOCKER_PROJECT_DIR/.patterns\" \
		-w \"$DOCKER_PROJECT_DIR\" \
		$RUN_ARGS \
		--entrypoint /bin/bash \
		--rm $flag -t \"$image\" \
		-i -c \"$command\")

	if [ -n "$interactive" ]; then
		eval "$process"
	else
		eval "$process" & pid=$!

		trap "kill -s INT '$pid'; exit 130" SIGINT
		trap "kill -s TERM '$pid'; exit 143" SIGTERM
		wait "$pid"

		trap - SIGINT SIGTERM
		wait "$pid"
	fi
}
