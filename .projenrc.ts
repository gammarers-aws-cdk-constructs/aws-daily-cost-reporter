import { awscdk, javascript, github } from 'projen';
const project = new awscdk.AwsCdkConstructLibrary({
  author: 'yicr',
  authorAddress: 'yicr@users.noreply.github.com',
  cdkVersion: '2.232.0',
  typescriptVersion: '5.9.x',
  jsiiVersion: '5.9.x',
  defaultReleaseBranch: 'main',
  name: 'aws-daily-cost-reporter',
  description: 'This library deploys an AWS Cost and Usage reporter that runs daily and posts a cost summary to Slack.',
  keywords: ['aws', 'cdk', 'aws-cdk', 'cost', 'reports', 'slack'],
  majorVersion: 3,
  projenrcTs: true,
  repositoryUrl: 'https://github.com/gammarers-aws-cdk-constructs/aws-daily-cost-reporter.git',
  deps: [
  ],
  devDeps: [
    '@aws/durable-execution-sdk-js@^1',
    '@aws-sdk/client-cost-explorer@^3',
    '@aws-sdk/client-lambda@^3',
    '@slack/web-api@^6',
    '@types/aws-lambda@^8',
    'aws-sdk-client-mock@^2',
    'aws-sdk-client-mock-jest@^2',
    'aws-lambda-secret-fetcher@^0.3',
    '@gammarers/jest-aws-cdk-asset-filename-renamer@~0.5.0',
  ],
  jestOptions: {
    jestConfig: {
      snapshotSerializers: ['@gammarers/jest-aws-cdk-asset-filename-renamer'],
    },
    extraCliOptions: ['--silent'],
  },
  lambdaOptions: {
    // target node.js runtime
    runtime: awscdk.LambdaRuntime.NODEJS_22_X,
    bundlingOptions: {
      // list of node modules to exclude from the bundle
      externals: ['@aws-sdk/*'],
      sourcemap: true,
    },
  },
  releaseToNpm: true,
  npmTrustedPublishing: true,
  npmAccess: javascript.NpmAccess.PUBLIC,
  minNodeVersion: '20.0.0',
  workflowNodeVersion: '24.x',
  depsUpgradeOptions: {
    workflowOptions: {
      labels: ['auto-approve', 'auto-merge'],
      schedule: javascript.UpgradeDependenciesSchedule.WEEKLY,
    },
  },
  githubOptions: {
    projenCredentials: github.GithubCredentials.fromApp({
      permissions: {
        pullRequests: github.workflows.AppPermission.WRITE,
        contents: github.workflows.AppPermission.WRITE,
      },
    }),
  },
  autoApproveOptions: {
    allowedUsernames: [
      'gammarers-projen-upgrade-bot[bot]',
      'yicr',
    ],
  },
  // publishToPypi: {
  //   distName: 'gammarers.aws-daily-cost-usage-report-stack',
  //   module: 'gammarers.aws_daily_cost_usage_report-stack',
  // },
});
project.synth();