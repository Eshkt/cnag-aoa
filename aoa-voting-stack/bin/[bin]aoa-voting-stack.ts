#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { AoaVotingStack } from '../lib/aoa-voting-stack';

const app = new App();
new AoaVotingStack(app, 'AoaVotingStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
