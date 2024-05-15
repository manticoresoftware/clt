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
source "$PROJECT_DIR/lib/rec.sh"
source "$PROJECT_DIR/lib/argument.sh"

docker_image=$(argument_parse_docker_image "$@")
set -- "${@:1:$(($#-1))}"

# Define defaults
file_prefix=${docker_image/:/_}
file_prefix=${docker_image/\//_}
current_date=$(date +%Y%m%d_%H%M%S)
record_file="./tests/${file_prefix}_${current_date}.rec"

# By default we ask user to refine tests that differ
refine=1

# Parse input arguments for this command
while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in
    -t=*|--test-file=*)
      record_file="${key#*=}"
      shift
      ;;
    -t|--test-file)
      record_file="$2"
      shift
      shift
      ;;
    -n|--no-refine)
      refine=0
      shift
      ;;
    *)
      >&2 echo "Unsupported flag: $key" && exit 1
      ;;
  esac
done

record "$docker_image" "$record_file"

# Check if we have refine
if [ $refine -eq 1 ]; then
  refine "$docker_image" "$record_file"
fi