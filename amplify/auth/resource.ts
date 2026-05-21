import { defineAuth } from '@aws-amplify/backend';
import { autoConfirm } from './functions/autoConfirm/resource.ts';

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  userAttributes: {
    email: {
      required: true,
      mutable: false,
    },
    fullname: {
      dataType: 'String',
      mutable: true,
    },
    'custom:studentNumber': {
      dataType: 'String',
      mutable: true,
    },
  },
  multifactor: {
    mode: 'OFF',
  },
  accountRecovery: 'NONE',
  groups: ['comelec-admin'],
  triggers: {
    preSignUp: autoConfirm,
  },
});
