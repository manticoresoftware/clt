#!/usr/bin/env bash
# Copyright (c) 2023, Manticore Software LTD (https:#manticoresearch.com)
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
  if [ -z "$image" ] || [ -z "$command" ]; then
    >&2 echo 'Usage: container_exec "image" "command"' && exit 1
  fi

  docker run \
    -v "$bin_path/rec:/usr/bin/clt-rec" \
    -v "$bin_path/cmp:/usr/bin/clt-cmp" \
    -v "$PWD/tests:$DOCKER_PROJECT_DIR/tests" \
    -w "$DOCKER_PROJECT_DIR" \
    $RUN_ARGS \
    --entrypoint /bin/bash \
    --rm -it "$image" \
    -i -c "$command"
}

