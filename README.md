# Helix Content Bus

> Serverless action that pushes helix-content-proxy into a storage service

**Note**: The content-bus action is no longer used. its functionality is now embedded in helix-admin.

## Status
[![codecov](https://img.shields.io/codecov/c/github/adobe/helix-content-bus.svg)](https://codecov.io/gh/adobe/helix-content-bus)
[![CircleCI](https://img.shields.io/circleci/project/github/adobe/helix-content-bus.svg)](https://circleci.com/gh/adobe/helix-content-bus)
[![GitHub license](https://img.shields.io/github/license/adobe/helix-content-bus.svg)](https://github.com/adobe/helix-content-bus/blob/main/LICENSE.txt)
[![GitHub issues](https://img.shields.io/github/issues/adobe/helix-content-bus.svg)](https://github.com/adobe/helix-content-bus/issues)
[![LGTM Code Quality Grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/adobe/helix-content-bus.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/adobe/helix-content-bus)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Installation

## Usage

The following parameters should be passed when invoking the action:
- `owner`: GitHub repository owner
- `repo`: GitHub repository name
- `ref`: GitHub repository reference or branch
- `path`: path to the document to be fetched from helix-content-proxy
- `prefix`: prefix to add to the S3 address, defaults to `live`

Note: the first three parameters also determine the location where the `fstab.yaml` configuration file is downloaded from.
The service requires that file to find a matching mount point, which also determines the bucket name used in S3.

The following environment variables are optional:
- `AWS_S3_REGION`: AWS region
- `AWS_S3_ACCESS_KEY_ID`: AWS access key associated with an IAM user or role
- `AWS_S3_SECRET_ACCESS_KEY`: Specifies the secret key associated with the access key

If they're not specified, the function operates with whatever role it was deployed with.

## Development

### Deploying Helix Content Bus

All commits to main that pass the testing will be deployed automatically. All commits to branches that will pass the testing will get commited as `/helix-services/content-bus@ci<num>` and tagged with the CI build number.
