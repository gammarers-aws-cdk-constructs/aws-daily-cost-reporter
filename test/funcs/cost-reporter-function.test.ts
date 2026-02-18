import {
  DurableExecutionInvocationInput,
  InvocationStatus,
} from '@aws/durable-execution-sdk-js';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import {
  CheckpointDurableExecutionCommand,
  GetDurableExecutionStateCommand,
  LambdaClient,
} from '@aws-sdk/client-lambda';
import { WebClient } from '@slack/web-api';
import { Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { handler, EventInputType } from '../../src/funcs/cost-report.lambda';
import type { EventInput } from '../../src/funcs/cost-report.lambda';

jest.mock('@slack/web-api');
const mockGetSecretValue = jest.fn();
jest.mock('aws-lambda-secret-fetcher', () => ({
  secretFetcher: {
    getSecretValue: (...args: unknown[]) => mockGetSecretValue(...args),
  },
}));

const lambdaMock = mockClient(LambdaClient);

/** Durable Execution ランタイムが渡すペイロードを再現（テスト用） */
function createDurableInvocationInput(event: EventInput): DurableExecutionInvocationInput {
  return {
    DurableExecutionArn: 'arn:aws:lambda:us-east-1:123456789012:function:cost-report',
    CheckpointToken: 'test-checkpoint-token',
    InitialExecutionState: {
      Operations: [
        {
          ExecutionDetails: {
            InputPayload: JSON.stringify(event),
          },
        } as unknown as DurableExecutionInvocationInput['InitialExecutionState']['Operations'][0],
      ],
    },
  };
}

describe('Lambda Function Handler testing', () => {
  const ceClientMock = mockClient(CostExplorerClient);

  beforeEach(() => {
    ceClientMock.reset();
    lambdaMock.reset();
    mockGetSecretValue.mockResolvedValue({
      token: 'xxxx-xxxxxxxxx-xxxx',
      channel: 'example-channel',
    });
    lambdaMock.on(GetDurableExecutionStateCommand).resolves({ Operations: [] });
    lambdaMock.on(CheckpointDurableExecutionCommand).resolves({
      CheckpointToken: 'next-token',
      NewExecutionState: {},
    });
    (WebClient as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ok: true }),
      },
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Not beginning of the month...', () => {
    beforeEach(() => {
      Date.now = jest.fn(() => new Date(2023, 1, 23, 2, 2, 2).getTime());
    });

    describe('Lambda Function handler', () => {
      describe('Event Input Type = Services', () => {
        it('Should client succeed', async () => {

          ceClientMock
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
            })
            .resolves({
              $metadata: {
                httpStatusCode: 200,
              },
              ResultsByTime: [
                {
                  Estimated: true,
                  Groups: [],
                  TimePeriod: {
                    Start: '2023-02-01',
                    End: '2023-02-22',
                  },
                  Total: {
                    AmortizedCost: {
                      Amount: '1.23456',
                      Unit: 'USD',
                    },
                  },
                },
              ],
            })
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
              GroupBy: [
                {
                  Type: 'DIMENSION',
                  Key: 'SERVICE',
                },
              ],
            })
            .resolves({
              $metadata: {
                httpStatusCode: 200,
              },
              NextPageToken: 'XXXxxXXXxxXXXxxXXXxxXXXxxXXXxxXXXxxXXXxx',
              ResultsByTime: [
                {
                  Estimated: false,
                  TimePeriod: {
                    End: '2023-02-28',
                    Start: '2023-02-01',
                  },
                  Total: {},
                  Groups: [
                    {
                      Keys: [
                        'AWS CloudTrail',
                      ],
                      Metrics: {
                        AmortizedCost: {
                          Amount: '0',
                          Unit: 'USD',
                        },
                      },
                    },
                    {
                      Keys: [
                        'AWS Config',
                      ],
                      Metrics: {
                        AmortizedCost: {
                          Amount: '0.012',
                          Unit: 'USD',
                        },
                      },
                    },
                  ],
                },
              ],
            })
            .on(GetCostAndUsageCommand, {
              NextPageToken: 'XXXxxXXXxxXXXxxXXXxxXXXxxXXXxxXXXxxXXXxx',
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
              GroupBy: [
                {
                  Type: 'DIMENSION',
                  Key: 'SERVICE',
                },
              ],
            })
            .resolves({
              $metadata: {
                httpStatusCode: 200,
              },
              ResultsByTime: [
                {
                  Estimated: false,
                  TimePeriod: {
                    End: '2023-02-28',
                    Start: '2023-02-01',
                  },
                  Total: {},
                  Groups: [
                    {
                      Keys: [
                        'Tax',
                      ],
                      Metrics: {
                        AmortizedCost: {
                          Amount: '1.39',
                          Unit: 'USD',
                        },
                      },
                    },
                  ],
                },
              ],
            });

          process.env = {
            SLACK_SECRET_NAME: 'example/slack/webhook',
          };
          const result = await handler(
            createDurableInvocationInput({ type: EventInputType.SERVICES }),
            {} as Context,
          );

          expect(result.Status).toEqual(InvocationStatus.SUCCEEDED);
        });
        it('Should client error', async () => {
          ceClientMock
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
            })
            .rejects()
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
              GroupBy: [
                {
                  Type: 'DIMENSION',
                  Key: 'SERVICE',
                },
              ],
            })
            .rejects();

          process.env = {
            SLACK_SECRET_NAME: 'example/slack/webhook',
          };
          const result = await handler(
            createDurableInvocationInput({ type: EventInputType.SERVICES }),
            {} as Context,
          );

          expect(result.Status).toEqual(InvocationStatus.SUCCEEDED);
        });
        it('Should client unknown response', async () => {
          ceClientMock
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
            })
            .resolves({
              $metadata: {
                httpStatusCode: 200,
              },
            })
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
              GroupBy: [
                {
                  Type: 'DIMENSION',
                  Key: 'SERVICE',
                },
              ],
            })
            .resolves({
              $metadata: {
                httpStatusCode: 200,
              },
            });

          process.env = {
            SLACK_SECRET_NAME: 'example/slack/webhook',
          };
          const result = await handler(
            createDurableInvocationInput({ type: EventInputType.SERVICES }),
            {} as Context,
          );

          expect(result.Status).toEqual(InvocationStatus.SUCCEEDED);
        });
      });

      describe('Event Input Type = Accounts', () => {
        it('Should client succeed', async () => {

          ceClientMock
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
            })
            .resolves({
              $metadata: {
                httpStatusCode: 200,
              },
              ResultsByTime: [
                {
                  Estimated: true,
                  Groups: [],
                  TimePeriod: {
                    Start: '2023-02-01',
                    End: '2023-02-22',
                  },
                  Total: {
                    AmortizedCost: {
                      Amount: '1.23456',
                      Unit: 'USD',
                    },
                  },
                },
              ],
            })
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
              GroupBy: [
                {
                  Type: 'DIMENSION',
                  Key: 'LINKED_ACCOUNT',
                },
              ],
            })
            .resolves({
              $metadata: {
                httpStatusCode: 200,
              },
              NextPageToken: 'XXXxxXXXxxXXXxxXXXxxXXXxxXXXxxXXXxxXXXxx',
              ResultsByTime: [
                {
                  Estimated: false,
                  TimePeriod: {
                    End: '2023-02-28',
                    Start: '2023-02-01',
                  },
                  Total: {},
                  Groups: [
                    {
                      Keys: [
                        '111111111111',
                      ],
                      Metrics: {
                        AmortizedCost: {
                          Amount: '67.4724468979',
                          Unit: 'USD',
                        },
                      },
                    },
                    {
                      Keys: [
                        '222222222222',
                      ],
                      Metrics: {
                        AmortizedCost: {
                          Amount: '6.8423283327',
                          Unit: 'USD',
                        },
                      },
                    },
                    {
                      Keys: [
                        '333333333333',
                      ],
                      Metrics: {
                        AmortizedCost: {
                          Amount: '7.1233988094',
                          Unit: 'USD',
                        },
                      },
                    },
                  ],
                },
              ],
              DimensionValueAttributes: [
                {
                  Value: '111111111111',
                  Attributes: {
                    description: 'Example System 1A',
                  },
                },
                {
                  Value: '222222222222',
                  Attributes: {
                    description: 'Example System 2A',
                  },
                },
                {
                  Value: '333333333333',
                  Attributes: {
                    description: 'Example System 3A',
                  },
                },
              ],
            })
            .on(GetCostAndUsageCommand, {
              NextPageToken: 'XXXxxXXXxxXXXxxXXXxxXXXxxXXXxxXXXxxXXXxx',
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
              GroupBy: [
                {
                  Type: 'DIMENSION',
                  Key: 'LINKED_ACCOUNT',
                },
              ],
            })
            .resolves({
              $metadata: {
                httpStatusCode: 200,
              },
              ResultsByTime: [
                {
                  Estimated: false,
                  TimePeriod: {
                    End: '2023-02-28',
                    Start: '2023-02-01',
                  },
                  Total: {},
                  Groups: [
                    {
                      Keys: [
                        '444444444444',
                      ],
                      Metrics: {
                        AmortizedCost: {
                          Amount: '0.4724468979',
                          Unit: 'USD',
                        },
                      },
                    },
                  ],
                },
              ],
              DimensionValueAttributes: [
                {
                  Value: '444444444444',
                  Attributes: {
                    description: 'Example System 4A',
                  },
                },
              ],
            });

          process.env = {
            SLACK_SECRET_NAME: 'example/slack/webhook',
          };
          const result = await handler(
            createDurableInvocationInput({ type: EventInputType.ACCOUNTS }),
            {} as Context,
          );

          expect(result.Status).toEqual(InvocationStatus.SUCCEEDED);
        });

        it('Should client error', async () => {
          ceClientMock
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
            })
            .rejects()
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
              GroupBy: [
                {
                  Type: 'DIMENSION',
                  Key: 'LINKED_ACCOUNT',
                },
              ],
            })
            .rejects();

          process.env = {
            SLACK_SECRET_NAME: 'example/slack/webhook',
          };
          const result = await handler(
            createDurableInvocationInput({ type: EventInputType.ACCOUNTS }),
            {} as Context,
          );

          expect(result.Status).toEqual(InvocationStatus.SUCCEEDED);
        });

        it('Should client unknown response', async () => {
          ceClientMock
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
            })
            .resolves({
              $metadata: {
                httpStatusCode: 200,
              },
            })
            .on(GetCostAndUsageCommand, {
              TimePeriod: {
                Start: '2023-02-01',
                End: '2023-02-22',
              },
              Granularity: 'MONTHLY',
              Metrics: [
                'AMORTIZED_COST',
              ],
              GroupBy: [
                {
                  Type: 'DIMENSION',
                  Key: 'SERVICE',
                },
              ],
            })
            .resolves({
              $metadata: {
                httpStatusCode: 200,
              },
            });

          process.env = {
            SLACK_SECRET_NAME: 'example/slack/webhook',
          };
          const result = await handler(
            createDurableInvocationInput({ type: EventInputType.ACCOUNTS }),
            {} as Context,
          );

          expect(result.Status).toEqual(InvocationStatus.SUCCEEDED);
        });
      });
    });
  });

  describe('Beginning of the month...', () => {
    beforeEach(() => {
      Date.now = jest.fn(() => new Date(2023, 1, 1, 2, 2, 2).getTime());
    });

    describe('Lambda Function handler', () => {
      it('Should client succeed', async () => {

        ceClientMock
          .on(GetCostAndUsageCommand, {
            TimePeriod: {
              Start: '2023-01-01',
              End: '2023-01-31',
            },
            Granularity: 'MONTHLY',
            Metrics: [
              'AMORTIZED_COST',
            ],
          })
          .resolves({
            $metadata: {
              httpStatusCode: 200,
            },
            ResultsByTime: [
              {
                Estimated: true,
                Groups: [],
                TimePeriod: {
                  Start: '2023-02-01',
                  End: '2023-02-22',
                },
                Total: {
                  AmortizedCost: {
                    Amount: '1.23456',
                    Unit: 'USD',
                  },
                },
              },
            ],
          })
          .on(GetCostAndUsageCommand, {
            TimePeriod: {
              Start: '2023-01-01',
              End: '2023-01-31',
            },
            Granularity: 'MONTHLY',
            Metrics: [
              'AMORTIZED_COST',
            ],
            GroupBy: [
              {
                Type: 'DIMENSION',
                Key: 'SERVICE',
              },
            ],
          })
          .resolves({
            $metadata: {
              httpStatusCode: 200,
            },
            ResultsByTime: [
              {
                Estimated: false,
                TimePeriod: {
                  End: '2023-02-28',
                  Start: '2023-02-01',
                },
                Total: {},
                Groups: [
                  {
                    Keys: [
                      'AWS CloudTrail',
                    ],
                    Metrics: {
                      AmortizedCost: {
                        Amount: '0',
                        Unit: 'USD',
                      },
                    },
                  },
                  {
                    Keys: [
                      'AWS Config',
                    ],
                    Metrics: {
                      AmortizedCost: {
                        Amount: '0.012',
                        Unit: 'USD',
                      },
                    },
                  },
                  {
                    Keys: [
                      'Tax',
                    ],
                    Metrics: {
                      AmortizedCost: {
                        Amount: '1.39',
                        Unit: 'USD',
                      },
                    },
                  },
                ],
              },
            ],
          });

        process.env = {
          SLACK_SECRET_NAME: 'example/slack/webhook',
        };
        const result = await handler(
          createDurableInvocationInput({ type: EventInputType.SERVICES }),
          {} as Context,
        );

        expect(result.Status).toEqual(InvocationStatus.SUCCEEDED);
      });

    });

  });

  describe('Error handling', () => {
    describe('Environment variable', () => {
      it('returns FAILED when SLACK_SECRET_NAME is missing', async () => {
        process.env = {};
        const result = await handler(
          createDurableInvocationInput({ type: EventInputType.SERVICES }),
          {} as Context,
        );
        expect(result.Status).toEqual(InvocationStatus.FAILED);
        expect((result as { Error?: unknown }).Error).toBeDefined();
      });
      it('returns FAILED when secret has no token', async () => {
        mockGetSecretValue.mockResolvedValueOnce({ channel: 'example-channel' });
        process.env = { SLACK_SECRET_NAME: 'example/slack/webhook' };
        const result = await handler(
          createDurableInvocationInput({ type: EventInputType.SERVICES }),
          {} as Context,
        );
        expect(result.Status).toEqual(InvocationStatus.FAILED);
        expect((result as { Error?: unknown }).Error).toBeDefined();
        const err = (result as { Error?: { message?: string } }).Error;
        expect(err && 'message' in err ? String(err.message) : JSON.stringify(err)).toContain('token and channel');
      });
      it('returns FAILED when secret has no channel', async () => {
        mockGetSecretValue.mockResolvedValueOnce({ token: 'xxxx-xxxxxxxxx-xxxx' });
        process.env = { SLACK_SECRET_NAME: 'example/slack/webhook' };
        const result = await handler(
          createDurableInvocationInput({ type: EventInputType.SERVICES }),
          {} as Context,
        );
        expect(result.Status).toEqual(InvocationStatus.FAILED);
        expect((result as { Error?: unknown }).Error).toBeDefined();
        const err = (result as { Error?: { message?: string } }).Error;
        expect(err && 'message' in err ? String(err.message) : JSON.stringify(err)).toContain('token and channel');
      });
    });
    describe('Event input', () => {
      it('returns FAILED when Type is empty', async () => {
        process.env = {
          SLACK_SECRET_NAME: 'example/slack/webhook',
        };
        const result = await handler(
          createDurableInvocationInput({ type: '' as EventInputType }),
          {} as Context,
        );
        expect(result.Status).toEqual(InvocationStatus.FAILED);
        expect((result as { Error?: unknown }).Error).toBeDefined();
      });
      it('returns FAILED when Type is invalid', async () => {
        process.env = {
          SLACK_SECRET_NAME: 'example/slack/webhook',
        };
        const result = await handler(
          createDurableInvocationInput({ type: 'Miss' as EventInputType }),
          {} as Context,
        );
        expect(result.Status).toEqual(InvocationStatus.FAILED);
      });
    });
  });
});