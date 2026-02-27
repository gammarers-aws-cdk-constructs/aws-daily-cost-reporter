# AWS Daily Cost Reporter

[![GitHub](https://img.shields.io/github/license/gammarers-aws-cdk-constructs/aws-daily-cost-reporter?style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/aws-daily-cost-reporter/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/aws-daily-cost-reporter?style=flat-square)](https://www.npmjs.com/package/aws-daily-cost-reporter)
[![GitHub Workflow Status (branch)](https://img.shields.io/github/actions/workflow/status/gammarers-aws-cdk-constructs/aws-daily-cost-reporter/release.yml?branch=main&label=release&style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/aws-daily-cost-reporter/actions/workflows/release.yml)
[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/gammarers-aws-cdk-constructs/aws-daily-cost-reporter?sort=semver&style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/aws-daily-cost-reporter/releases)

This library deploys an AWS Cost and Usage reporter that runs daily and posts a cost summary to Slack. It uses **AWS Cost Explorer** to fetch amortized costs for a configurable period, then sends a formatted message (total cost plus a breakdown by AWS service or by linked account) to a Slack channel. Credentials are read from **AWS Secrets Manager**, and execution is driven by **EventBridge Scheduler** at 09:01 UTC. The reporting Lambda uses **Durable Execution** so that long-running or retried runs are handled reliably.

## Features

- **Daily scheduled report** – EventBridge Scheduler triggers at 09:01 UTC every day.
- **Cost by service** – Report grouped by AWS service (`CostGroupType.SERVICES`); useful for seeing which services drive cost.
- **Cost by account** – Report grouped by linked account when using AWS Organizations (`CostGroupType.ACCOUNTS`); useful for chargeback or per-account visibility.
- **Slack delivery** – Sends the report to a Slack channel; Slack credentials are stored in AWS Secrets Manager (no hardcoded tokens).
- **Durable execution** – Lambda uses AWS Durable Execution so that steps (fetch secret, Cost Explorer calls, Slack post) are durable and retries are safe.
- **Managed resources** – The construct provisions the Lambda (with IAM role and CloudWatch Logs), EventBridge Scheduler, and grants read access to the Slack secret.

## How it works

- **Schedule** – Each day at 09:01 UTC, EventBridge Scheduler invokes the Lambda with a payload that indicates whether to group by service or by account.
- **Date range** – The report period is computed automatically:
  - On the **1st of the month**, the period is the **previous full month** (e.g. 2025-01-01 to 2025-01-31).
  - On any other day, the period is **from the 1st of the current month through yesterday** (e.g. 2025-02-01 to 2025-02-20).
- **Data source** – The Lambda calls the Cost Explorer API (`GetCostAndUsage`) in `us-east-1` with **amortized cost** and **monthly** granularity.
- **Slack message** – The Lambda posts two messages: first the **total cost** for the period, then a **thread reply** with the breakdown (each service or each linked account and its cost). All amounts use the same currency unit returned by Cost Explorer.

## Resources created

When you use `DailyCostReporter` or `DailyCostReportStack`, the following are created in your AWS account:

- **Lambda function** – ARM64, Node.js 22.x, with Durable Execution and Params and Secrets extension to read the Slack secret. It has permission to call Cost Explorer and to read the specified secret.
- **Lambda alias** – A `live` alias used as the EventBridge Scheduler target (required for Durable Execution).
- **IAM role** – For the Lambda (basic execution, Durable Execution, Cost Explorer `GetCostAndUsage`, and read access to the Slack secret).
- **CloudWatch Log group** – For the Lambda (3 months retention, destroyed with the stack).
- **EventBridge Scheduler schedule** – One-time per day at 09:01 UTC, invoking the Lambda alias with the chosen `costGroupType`.

## Architecture

The following diagram shows the high-level architecture of the daily cost reporter construct, including the EventBridge Scheduler trigger, the reporting Lambda function, its AWS data sources (Secrets Manager, Cost Explorer, CloudWatch Logs), and Slack as the notification destination.

![AWS Daily Cost Reporter architecture](diagrams/construct.svg)

## Installation

**npm**

```shell
npm install aws-daily-cost-reporter
```

**yarn**

```shell
yarn add aws-daily-cost-reporter
```

## Usage

Before using the construct or stack, create a secret in AWS Secrets Manager that holds your Slack Bot Token and the target channel (see [Secret format](#secret-format)). Then pass the secret **name** (not the ARN) in the `secrets.slackSecretName` option. The Lambda will read this secret at runtime via the Params and Secrets extension.

### Using the Construct

Use `DailyCostReporter` when you want to add the reporter to an existing CDK stack (e.g. a shared infrastructure stack). All resources (Lambda, scheduler, IAM, log group) will be created in that stack.

```typescript
import { CostGroupType, DailyCostReporter } from 'aws-daily-cost-reporter';

new DailyCostReporter(this, 'DailyCostReporter', {
  secrets: {
    slackSecretName: 'my-slack-credentials',
  },
  costGroupType: CostGroupType.ACCOUNTS,
});
```

### Using the Stack

Use `DailyCostReportStack` when you want a **standalone CDK stack** that only contains the daily cost reporter. This is useful if you prefer to deploy cost reporting separately from other application stacks or if you are getting started quickly.

```typescript
import { App } from 'aws-cdk-lib';
import { CostGroupType, DailyCostReportStack } from 'aws-daily-cost-reporter';

const app = new App();

new DailyCostReportStack(app, 'DailyCostReportStack', {
  secrets: {
    slackSecretName: 'my-slack-credentials',
  },
  costGroupType: CostGroupType.SERVICES,
});
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `secrets.slackSecretName` | `string` | Yes | Name of the AWS Secrets Manager secret that contains Slack credentials. The secret must exist in the same account and region as the stack. Its value must be a JSON object with `token` and `channel` (see [Secret format](#secret-format)). The Lambda is granted read permission on this secret by name. |
| `costGroupType` | `CostGroupType` | Yes | Controls how the Cost Explorer breakdown is grouped. Use `CostGroupType.SERVICES` for cost per AWS service (e.g. Amazon EC2, Amazon S3). Use `CostGroupType.ACCOUNTS` for cost per linked account (requires AWS Organizations; each member account appears as a line in the report). |

## Secret format

The Lambda reads Slack credentials from AWS Secrets Manager via the Params and Secrets extension. Store the credentials as a **plaintext** secret (not a key-value secret) whose value is a **JSON string** with the following keys:

| Key | Type | Description |
|-----|------|-------------|
| `token` | `string` | Slack Bot Token (e.g. `xoxb-...`). Create a Bot in your [Slack app](https://api.slack.com/apps) and use the OAuth **Bot User OAuth Token**. The bot needs at least the `chat:write` scope to post messages. |
| `channel` | `string` | Slack channel where the report is posted. You can use the channel ID (e.g. `C01234567`) or the channel name (e.g. `#cost-report`). The bot must be invited to the channel if it is private. |

**Example** – Secret value in Secrets Manager (the value of the secret must be this JSON as a string):

```json
{
  "token": "your-slack-token",
  "channel": "your-channel"
}
```

Create the secret in the **same AWS account and region** as the stack. Pass the secret **name** (e.g. `my-slack-credentials`) to `secrets.slackSecretName`; do not pass the full ARN.

## Requirements

- **Node.js** >= 20.0.0 (for building and deploying with CDK).
- **AWS CDK** ^2.232.0 and **constructs** ^10.0.5 (peer dependencies).
- **AWS account** – Cost Explorer must be available (it is enabled by default in most accounts). The Lambda runs in the same account and region as the stack and uses the account’s Cost Explorer data (including linked accounts if you use `CostGroupType.ACCOUNTS`).
- **AWS Secrets Manager** – A secret containing the Slack `token` and `channel` in the format described above.
- **Slack** – A Slack workspace, an app with a Bot that has `chat:write`, and a channel where the bot is allowed to post. Store the bot token and channel in the secret.

## License

This project is licensed under the Apache-2.0 License.
