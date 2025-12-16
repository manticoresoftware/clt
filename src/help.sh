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

cat <<EOF
CLT: Command Line Testing Utility

Usage: clt COMMAND [OPTIONS]

Commands:
record   Record an interactive session and store the inputs and outputs in a .rec file
test     Replay a recorded session and test for differences
refine   Replay a recorded session, compare the outputs, and edit differences
help     Show this help message

Record options:
  -t, --test-file=path-to-file
    Path to the .rec file to store inputs and outputs (optional)
  -n, --no-refine
    Do not run refine, just record inputs in the .rec file (optional)
  [docker image]
    Docker image to run commands in

Test options:
  -t, --test-file=path-to-file
    Path to the .rec file containing inputs and outputs
  -d, --debug, --diff
    Show diff produced by cmp tool to stdout
  -D, --delay=timeout-in-ms
    Delay between commands in ms (default: 50)
  [docker image]
    Docker image to run commands in

Refine options:
  -t, --test-file=path-to-file
    Path to the .rec file containing inputs and outputs
  [docker image]
    Docker image to run commands in

EOF
