import { defineStorage } from '@aws-amplify/backend';

/**
 * Define and configure your storage resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/storage
 */
export const storage = defineStorage({
  name: 'aoaVotingStorage',
  access: (allow) => ({
    'participants/*': [
      allow.authenticated.to(['read']),
      allow.guest.to(['read'])
    ],
    'audit/*': [
      allow.groups(['comelec-admin']).to(['read', 'write', 'delete']),
    ]
  })
});
