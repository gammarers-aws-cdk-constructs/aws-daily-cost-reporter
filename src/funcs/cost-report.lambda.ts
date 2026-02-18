import {
  withDurableExecution,
  DurableContext,
} from '@aws/durable-execution-sdk-js';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostAndUsageCommandInput,
  GetCostAndUsageCommandOutput,
} from '@aws-sdk/client-cost-explorer';
import { WebClient } from '@slack/web-api';
import { secretFetcher } from 'aws-lambda-secret-fetcher';

/**
 * Valid values for EventInput.Type (single source of truth for type and runtime check).
 */
export const EventInputType = {
  ACCOUNTS: 'accounts',
  SERVICES: 'services',
} as const;

export type EventInputType = (typeof EventInputType)[keyof typeof EventInputType];

/**
 * Input event payload for the cost report Lambda handler.
 */
export interface EventInput {
  readonly type: EventInputType;
}

/**
 * Field for a Slack message attachment (title/value pair).
 */
export interface MessageAttachmentField {
  readonly title: string;
  readonly value: string;
}

/**
 * Date range in YYYY-MM-DD format for Cost Explorer queries.
 */
export interface DateRange {
  readonly start: string;
  readonly end: string;
}

/**
 * Total billing amount and currency unit for a period.
 */
export interface TotalBilling {
  readonly unit: string;
  readonly amount: number;
}

/**
 * Billing amount for a single AWS service.
 */
export interface ServiceBilling {
  readonly service: string;
  readonly unit: string;
  readonly amount: number;
}

/**
 * Billing amount for a single linked account (with optional description).
 */
export interface AccountBilling {
  readonly account: string;
  readonly amount: number;
  readonly unit: string;
}

export interface SlackSecret {
  readonly token: string;
  readonly channel: string;
}

/**
 * Formats a Date as YYYY-MM-DD.
 * @param date - Date to format
 * @returns Formatted date string
 */
const dateFormatString = (date: Date): string =>
  `${date.getFullYear()}-${('00' + (date.getMonth() + 1)).slice(-2)}-${('00' + date.getDate()).slice(-2)}`;

/**
 * Returns the date range for the current reporting period.
 * On the 1st of the month, returns the previous full month; otherwise returns from the 1st to yesterday.
 * @returns Start and end dates in YYYY-MM-DD format
 */
const getDateRange = (): DateRange => {
  const now = new Date(Date.now());
  if (now.getDate() === 1) {
    return {
      start: dateFormatString(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      end: dateFormatString(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  return {
    start: dateFormatString(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: dateFormatString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
  };
};

/**
 * Fetches total amortized cost for the given date range from Cost Explorer.
 * @param client - Cost Explorer client
 * @param dateRange - Start and end dates for the query
 * @returns Total billing (unit and amount), or undefined on error or empty result
 */
const getTotalBilling = async (
  client: CostExplorerClient,
  dateRange: DateRange,
): Promise<TotalBilling | undefined> => {
  const input: GetCostAndUsageCommandInput = {
    TimePeriod: {
      Start: dateRange.start,
      End: dateRange.end,
    },
    Granularity: 'MONTHLY',
    Metrics: ['AMORTIZED_COST'],
  };
  console.log(`TotalBilling:Command:Input:${JSON.stringify(input)}`);
  return client
    .send(new GetCostAndUsageCommand(input))
    .then((data: GetCostAndUsageCommandOutput) => {
      if (data?.ResultsByTime?.length === 1) {
        const cost = Object(data.ResultsByTime[0]).Total.AmortizedCost;
        const result: TotalBilling = {
          unit: cost.Unit,
          amount: cost.Amount,
        };
        console.log(`TotalBilling:Command:Output(Shaped):${JSON.stringify(result)}`);
        return result;
      }
      return undefined;
    })
    .catch((error) => {
      console.log('Error caught...');
      console.log(`Error:${JSON.stringify(error)}`);
      return undefined;
    });
};

/**
 * Fetches amortized cost grouped by AWS service for the given date range.
 * Handles pagination via NextPageToken.
 * @param client - Cost Explorer client
 * @param dateRange - Start and end dates for the query
 * @param nextPageToken - Optional token for the next page of results
 * @returns Array of service billings, or undefined on error or empty result
 */
const getServiceBilling = async (
  client: CostExplorerClient,
  dateRange: DateRange,
  nextPageToken?: string,
): Promise<ServiceBilling[] | undefined> => {
  const input: GetCostAndUsageCommandInput = {
    NextPageToken: nextPageToken,
    TimePeriod: {
      Start: dateRange.start,
      End: dateRange.end,
    },
    Granularity: 'MONTHLY',
    Metrics: ['AMORTIZED_COST'],
    GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
  };
  console.log(`ServiceBillings:Command:Input:${JSON.stringify(input)}`);
  return client
    .send(new GetCostAndUsageCommand(input))
    .then(async (data) => {
      const billings: ServiceBilling[] = [];
      if (data.ResultsByTime?.length === 1) {
        for (const item of Object(data.ResultsByTime[0]).Groups) {
          billings.push({
            service: item.Keys[0],
            unit: item.Metrics.AmortizedCost.Unit,
            amount: item.Metrics.AmortizedCost.Amount,
          });
        }
        console.log(`ServiceBillings:Command:Output(Shaped):${JSON.stringify(billings)}`);
        if (data.NextPageToken) {
          const nextBillings = await getServiceBilling(client, dateRange, data.NextPageToken);
          if (nextBillings) {
            return billings.concat(nextBillings);
          }
        }
        return billings;
      }
      return undefined;
    })
    .catch(async (error) => {
      console.log('Error caught...');
      console.log(`Error:${JSON.stringify(error)}`);
      return undefined;
    });
};

/**
 * Fetches amortized cost grouped by linked account for the given date range.
 * Uses dimension value attributes to include account descriptions. Handles pagination.
 * @param client - Cost Explorer client
 * @param dateRange - Start and end dates for the query
 * @param nextPageToken - Optional token for the next page of results
 * @returns Array of account billings, or undefined on error or empty result
 */
const getAccountBillings = async (
  client: CostExplorerClient,
  dateRange: DateRange,
  nextPageToken?: string,
): Promise<AccountBilling[] | undefined> => {
  const input: GetCostAndUsageCommandInput = {
    NextPageToken: nextPageToken,
    TimePeriod: {
      Start: dateRange.start,
      End: dateRange.end,
    },
    Granularity: 'MONTHLY',
    Metrics: ['AMORTIZED_COST'],
    GroupBy: [{ Type: 'DIMENSION', Key: 'LINKED_ACCOUNT' }],
  };
  console.log(`AccountBillings:Command:Input:${JSON.stringify(input)}`);
  return client
    .send(new GetCostAndUsageCommand(input))
    .then(async (data) => {
      const billings: AccountBilling[] = [];
      if (data.ResultsByTime?.length === 1) {
        const groups = Object(data.ResultsByTime[0]).Groups;
        const dimensionValueAttributes = data.DimensionValueAttributes ?? [];
        for (const item of groups) {
          for (const attr of dimensionValueAttributes) {
            if (item.Keys[0] === attr.Value) {
              billings.push({
                account: `${attr.Value} (${attr.Attributes?.description ?? ''})`,
                unit: item.Metrics.AmortizedCost.Unit,
                amount: item.Metrics.AmortizedCost.Amount,
              });
            }
          }
        }
        console.log(`AccountBillings:Command:Output(Shaped):${JSON.stringify(billings)}`);
        if (data.NextPageToken) {
          const nextBillings = await getAccountBillings(client, dateRange, data.NextPageToken);
          if (nextBillings) {
            return billings.concat(nextBillings);
          }
        }
        return billings;
      }
      return undefined;
    })
    .catch(async (error) => {
      console.log('Error caught...');
      console.log(`Error:${JSON.stringify(error)}`);
      return undefined;
    });
};

/** Cost Explorer client for us-east-1 (required for Cost Explorer API). */
const ceClient = new CostExplorerClient({
  region: 'us-east-1',
});

/**
 * Durable execution handler for the daily cost report.
 * Computes date range, fetches total and detail billings (by account or service), and posts to Slack.
 * Requires SLACK_SECRET_NAME (secret must be JSON with token and channel); event.Type must be EventInputType.ACCOUNTS or EventInputType.SERVICES.
 * @param event - Event input with Type (Accounts or Services)
 * @param context - Durable execution context for steps and logging
 * @returns 'OK' on success, or throws on missing env/input or invalid Type
 */
export const handler = withDurableExecution(async (
  event: EventInput,
  context: DurableContext,
): Promise<string | Error> => {
  context.logger.info('Event received', { event });
  context.logger.info('Lambda context', { context: context.lambdaContext });

  const slackSecretName = process.env.SLACK_SECRET_NAME;
  if (!slackSecretName) {
    throw new Error('missing environment variable SLACK_SECRET_NAME.');
  }
  if (!event.type) {
    throw new Error('missing input variable type');
  }
  if (!Object.values(EventInputType).includes(event.type)) {
    throw new Error('invalid input variable Type. Valid values are accounts or services.');
  }

  const slackSecretValue = await context.step('fetch-slack-secret', async () => {
    return secretFetcher.getSecretValue<SlackSecret>(slackSecretName);
  });

  if (!slackSecretValue?.token || !slackSecretValue?.channel) {
    throw new Error('Slack secret must contain token and channel.');
  }

  const dateRange = await context.step('compute-date-range', async () => {
    const range = getDateRange();
    context.logger.info('DateRange computed', { dateRange: range });
    return range;
  });

  const totalBilling = await context.step('fetch-total-billing', async () => {
    const billing = await getTotalBilling(ceClient, dateRange);
    context.logger.info('TotalBilling fetched', { totalBilling: billing });
    return billing;
  });

  const fields = await context.step('fetch-detail-billings', async () => {
    switch (event.type) {
      case EventInputType.ACCOUNTS: {
        const accountBillings = await getAccountBillings(ceClient, dateRange);
        context.logger.info('AccountBillings fetched', {
          accountBillings,
        });
        return accountBillings?.map((value) => ({
          title: value.account,
          value: `${value.amount} ${value.unit}`,
        }));
      }
      case EventInputType.SERVICES: {
        const serviceBillings = await getServiceBilling(ceClient, dateRange);
        context.logger.info('ServiceBilling fetched', {
          serviceBillings,
        });
        return serviceBillings?.map((value) => ({
          title: value.service,
          value: `${value.amount} ${value.unit}`,
        }));
      }
    }
  });

  await context.step('post-slack-messages', async () => {
    const client = new WebClient(slackSecretValue.token);
    const channel = slackSecretValue.channel;

    const result = await client.chat.postMessage({
      channel,
      icon_emoji: ':money-with-wings:',
      text: `AWS Cost Reports (${dateRange.start} - ${dateRange.end})`,
      attachments: [
        {
          title: ':moneybag: Total',
          text: `${totalBilling?.amount} ${totalBilling?.unit}`,
          color: '#ff8c00',
        },
      ],
    });
    if (result.ok) {
      await client.chat.postMessage({
        channel,
        thread_ts: result.ts,
        attachments: [
          {
            color: '#ffd700',
            fields: fields?.map((filed) => ({
              title: `:aws: ${filed.title}`,
              value: filed.value,
              short: false,
            })),
          },
        ],
      });
    }
  });

  return 'OK';
});
