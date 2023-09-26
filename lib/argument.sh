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

argument_parse_docker_image() {
	if [ -z "$*" ]; then
		>&2 echo 'The Docker image is missing. Please refer to the help section for more information.' && exit 1
	fi

	docker_image="${!#}"

	image_exists=0
	if docker images --format "{{.Repository}}:{{.Tag}}" | grep "$docker_image" 1> /dev/null 2>&1; then
		image_exists=1
	fi

	if [ $image_exists = 0 ] && ! docker pull "$docker_image" 1> /dev/null 2>&1; then
		>&2 echo "Failed to find passed Docker image: $docker_image" && exit 1
	fi

	echo "$docker_image"
}
