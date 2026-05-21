import { defineFunction } from '@aws-amplify/backend';

export const autoConfirm = defineFunction({
  name: 'autoConfirm',
  entry: './handler.ts',
});
