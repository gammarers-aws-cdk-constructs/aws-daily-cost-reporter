import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CostGroupType, DailyCostReportStack } from '../src';

describe('Stack specific(all arguments) Testing', () => {

  const app = new App();

  const stack = new DailyCostReportStack(app, 'DailyCostReportStack', {
    costGroupType: CostGroupType.SERVICES,
    secrets: {
      slackSecretName: 'example/slack/webhook',
    },
  });

  const template = Template.fromStack(stack);

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