import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CostGroupType, DailyCostReporter, Secrets } from '../constructs/daily-cost-reporter';

/**
 * Props for the daily cost report stack (secrets and cost grouping).
 */
export interface DailyCostReportStackProps extends StackProps {
  readonly secrets: Secrets;
  readonly costGroupType: CostGroupType;
}

/**
 * CDK stack that deploys the daily cost reporter (Lambda, scheduler, IAM).
 */
export class DailyCostReportStack extends Stack {

  /**
   * Creates the stack and instantiates the DailyCostReporter construct.
   * @param scope - Parent construct
   * @param id - Stack id
   * @param props - Secrets and cost group type
   */
  constructor(scope: Construct, id: string, props: DailyCostReportStackProps) {
    super(scope, id, props);

    new DailyCostReporter(this, 'DailyCostReporter', {
      secrets: props.secrets,
      costGroupType: props.costGroupType,
    });
  }
}