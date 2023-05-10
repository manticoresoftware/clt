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
source "$PROJECT_DIR/lib/container.sh"

# Run recording of a new test in container with specified Docker image
record() {
  image=$1
  record_file=$2
  if [ -z "$image" ] || [ -z "$record_file" ]; then
    >&2 echo 'Usage: record "image" "record_file"' && exit 1
  fi

  # Validate that record_file dir exists
  record_dir=$(dirname "${record_file}")
  if [ ! -d "$record_dir" ]; then
    >&2 echo "Failed to locate directory to write recording: $record_dir" && exit 1
  fi

  # Validate that record file does not exist
  if [ -f "$record_file" ]; then
    >&2 echo "File to record exists, please, remove it first: $record_file" && exit 1
  fi

  echo "Recording data to file: $record_file"
  echo "Run commands one by one and after you finish press ^D to save"

  container_exec "$image" "clt-rec -O '$record_file'"
}

# Replay recorded test from the file
replay() {
  image=$1
  record_file=$2
  if [ -z "$image" ] || [ -z "$record_file" ]; then
    >&2 echo 'Usage: replay "image" "record_file"' && exit 1
  fi

  if [ ! -f "$record_file" ]; then
    >&2 echo "The record file does not exist: $record_file" && exit 1
  fi

  replay_file="${record_file%.*}.rep"
  echo "Replaying data from the file: $record_file"
  echo "The replay result will be stored to the file: $replay_file"

  container_exec "$image" "clt-rec -I '$record_file' -O $replay_file"
}

# Run compare binary
compare() {
  image=$1
  record_file=$2
  if [ -z "$image" ] || [ -z "$record_file" ] || [ -z "$replay_file" ]; then
    >&2 echo 'Usage: compare "image" "record_file" "replay_file"' && exit 1
  fi

  # We validate file existence in cmp tool, so it's fine to skip it here
  container_exec "$image" "clt-cmp '$record_file' '$replay_file'"
}

# Replay recorded test and launch refine
refine() {
  # Check that we have required software installed for this command
  editor=$( which nano | which vim | which vi )
  if [ -z "$editor" ]; then
    >&2 echo 'You need an editor installed to run refine process' && exit 1
  fi

  # Validate input args
  image=$1
  record_file=$2
  if [ -z "$image" ] || [ -z "$record_file" ]; then
    >&2 echo 'Usage: refine "image" "record_file"' && exit 1
  fi

  if [ ! -f "$record_file" ]; then
    >&2 echo "The record file does not exist: $record_file" && exit 1
  fi

  replay_file="${record_file%.*}.rep"

  replay "$image" "$record_file"
  compare "$image" "$record_file" "$replay_file" > "$record_file.diff" 2>&1 || true
  mv -f "$record_file.diff" "$record_file"
  $editor "$record_file"
}

# Replay and test against record file with cmp tool
test() {
  # Validate input args
  image=$1
  record_file=$2
  if [ -z "$image" ] || [ -z "$record_file" ]; then
    >&2 echo 'Usage: test "image" "record_file"' && exit 1
  fi

  if [ ! -f "$record_file" ]; then
    >&2 echo "The record file does not exist: $record_file" && exit 1
  fi

  replay_file="${record_file%.*}.rep"

  replay "$image" "$record_file"
  compare "$image" "$record_file" "$replay_file" > /dev/null 2>&1
}
