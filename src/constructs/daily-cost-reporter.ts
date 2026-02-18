import { Duration, RemovalPolicy, TimeZone } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { CostReportFunction } from '../funcs/cost-report-function';

/**
 * Secrets configuration for the cost reporter (e.g. Slack credentials).
 */
export interface Secrets {
  readonly slackSecretName: string;
}

/**
 * Cost grouping for the report: by linked account or by service.
 */
export enum CostGroupType {
  ACCOUNTS = 'ACCOUNTS',
  SERVICES = 'SERVICES',
}

/**
 * Props for the DailyCostReporter construct.
 */
export interface DailyCostReporterProps {
  readonly secrets: Secrets;
  readonly costGroupType: CostGroupType;
}

/**
 * CDK construct that provisions a daily cost report: Lambda (with durable execution),
 * EventBridge Scheduler, and IAM. Reports are sent to Slack; grouping is by account or service.
 */
export class DailyCostReporter extends Construct {
  /**
   * Creates the daily cost reporter (Lambda, schedule, and permissions).
   * @param scope - Parent construct
   * @param id - Construct id
   * @param props - Secrets and cost group type
   */
  constructor(scope: Construct, id: string, props: DailyCostReporterProps) {
    super(scope, id);

    // 👇 Get current account & region
    // const account = Stack.of(this).account;
    // const region = cdk.Stack.of(this).region;

    const slackSecret = Secret.fromSecretNameV2(this, 'SlackSecret', props.secrets.slackSecretName);

    // 👇 Lambda Function
    const costReportFunction = new CostReportFunction(this, 'CostReportFunction', {
      description: 'A function to report daily cost.',
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(15),
      memorySize: 512,
      retryAttempts: 2,
      durableConfig: {
        executionTimeout: Duration.hours(2),
        retentionPeriod: Duration.days(1),
      },
      environment: {
        SLACK_SECRET_NAME: props.secrets.slackSecretName,
      },
      paramsAndSecrets: lambda.ParamsAndSecretsLayerVersion.fromVersion(lambda.ParamsAndSecretsVersions.V1_0_103, {
        cacheSize: 500,
        logLevel: lambda.ParamsAndSecretsLogLevel.INFO,
      }),
      role: new iam.Role(this, 'CostReportFunctionRole', {
        description: 'A role to report daily cost.',
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicDurableExecutionRolePolicy'),
        ],
      }),
      logGroup: new logs.LogGroup(this, 'CostReportFunctionLogGroup', {
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      loggingFormat: lambda.LoggingFormat.JSON,
      systemLogLevelV2: lambda.SystemLogLevel.INFO,
      applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
    });
    // Grant read access to the Cost Explorer API
    costReportFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'GetCost',
      effect: iam.Effect.ALLOW,
      actions: [
        'ce:GetCostAndUsage',
      ],
      resources: ['*'],
    }));
    // Grant read access to the Slack secret
    slackSecret.grantRead(costReportFunction);

    // https://docs.aws.amazon.com/lambda/latest/dg/durable-getting-started-iac.html
    const costReportFunctionAlias = costReportFunction.addAlias('live');

    // Schedule (Durable Functions: Lambda performs tag lookup, export, and polling in one run)
    new scheduler.Schedule(this, 'LogArchiveSchedule', {
      description: 'daily CloudWatch Logs archive schedule',
      enabled: true,
      schedule: scheduler.ScheduleExpression.cron({
        minute: '9',
        hour: '9',
        timeZone: TimeZone.ETC_UTC,
      }),
      target: new targets.LambdaInvoke(costReportFunctionAlias, {
        input: scheduler.ScheduleTargetInput.fromObject({
          type: (() => {
            switch (props.costGroupType) {
              case CostGroupType.ACCOUNTS:
                return 'accounts';
              case CostGroupType.SERVICES:
                return 'services';
            }
          })(),
        }),
      }),
    });
  }

}