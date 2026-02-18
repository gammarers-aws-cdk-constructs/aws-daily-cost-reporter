import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CostGroupType, DailyCostReportStack } from '../src';

describe('Stack defualt(only required arguments) Testing', () => {

  const app = new App();

  const stack = new DailyCostReportStack(app, 'DailyCostReportStack', {
    secrets: {
      slackSecretName: 'example/slack/webhook',
    },
    costGroupType: CostGroupType.SERVICES,
  });

  const template = Template.fromStack(stack);

  describe('Lambda Testing', () => {

    it('Should have lambda execution role', () => {
      template.hasResourceProperties('AWS::IAM::Role', Match.objectLike({
        AssumeRolePolicyDocument: Match.objectEquals({
          Version: '2012-10-17',
          Statement: Match.arrayWith([
            Match.objectEquals({
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
              Action: 'sts:AssumeRole',
            }),
          ]),
        }),
        ManagedPolicyArns: Match.arrayWith([
          {
            'Fn::Join': Match.arrayEquals([
              '',
              Match.arrayEquals([
                'arn:',
                {
                  Ref: 'AWS::Partition',
                },
                ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
              ]),
            ]),
          },
          {
            'Fn::Join': Match.arrayEquals([
              '',
              Match.arrayEquals([
                'arn:',
                {
                  Ref: 'AWS::Partition',
                },
                ':iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy',
              ]),
            ]),
          },
        ]),
      }));
    });

    it('Should have GetCost inline policy attached to role', () => {
      template.hasResourceProperties('AWS::IAM::Policy', Match.objectLike({
        PolicyDocument: Match.objectLike({
          Version: '2012-10-17',
          Statement: Match.arrayWith([
            Match.objectEquals({
              Sid: 'GetCost',
              Effect: 'Allow',
              Action: 'ce:GetCostAndUsage',
              Resource: '*',
            }),
          ]),
        }),
      }));
    });

    it('Should have lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
        Handler: 'index.handler',
        Runtime: 'nodejs22.x',
        Timeout: 900,
        MemorySize: 512,
        Architectures: ['arm64'],
        Code: {
          S3Bucket: Match.anyValue(),
          S3Key: Match.stringLikeRegexp('.*.zip'),
        },
        Description: Match.anyValue(),
        Environment: {
          Variables: {
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
            SLACK_SECRET_NAME: Match.anyValue(),
          },
        },
        Role: {
          'Fn::GetAtt': [
            Match.stringLikeRegexp('CostReportFunctionRole'),
            'Arn',
          ],
        },
      }));
    });
  });

  // Schedule testing (target is Lambda Alias, cron 09:09 UTC)
  it('Should have Schedule', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', Match.objectLike({
      Description: Match.anyValue(),
      State: 'ENABLED',
      FlexibleTimeWindow: {
        Mode: 'OFF',
      },
      ScheduleExpressionTimezone: 'Etc/UTC',
      ScheduleExpression: 'cron(9 9 * * ? *)',
      Target: Match.objectLike({
        Arn: {
          Ref: Match.stringLikeRegexp('.*Alias.*'),
        },
        RoleArn: {
          'Fn::GetAtt': [
            Match.stringLikeRegexp('SchedulerRoleForTarget'),
            'Arn',
          ],
        },
        Input: Match.stringLikeRegexp('{"type":"(accounts|services)"}'),
        RetryPolicy: Match.objectLike({
          MaximumEventAgeInSeconds: 86400,
          MaximumRetryAttempts: 185,
        }),
      }),
    }));
    template.resourceCountIs('AWS::Scheduler::Schedule', 1);
  });

  it('Should match snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});