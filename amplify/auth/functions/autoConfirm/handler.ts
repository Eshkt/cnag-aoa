export const handler = async (event: any) => {
  // Auto confirm all users — no email verification needed
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};
