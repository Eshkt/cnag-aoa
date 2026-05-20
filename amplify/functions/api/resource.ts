import { defineFunction } from '@aws-amplify/backend';

export const apiFunction = defineFunction({
  name: 'apiServer',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 512,
});
