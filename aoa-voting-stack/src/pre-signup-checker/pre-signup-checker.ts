import { PreSignUpTriggerHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});
const PARTICIPANT_BUCKET = process.env.PARTICIPANT_BUCKET;

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = event.request.userAttributes.email;

  if (!email) {
    throw new Error('Email is required');
  }

  // 1. Check domain
  if (!email.toLowerCase().endsWith('@ust.edu.ph')) {
    throw new Error('Email domain not allowed');
  }

  // 2. Read participants.json from S3
  if (!PARTICIPANT_BUCKET) {
    console.error('PARTICIPANT_BUCKET env var not set');
    throw new Error('Participant list unavailable');
  }

  let participants: string[] = [];
  try {
    const s3Resp = await s3Client.send(new GetObjectCommand({
      Bucket: PARTICIPANT_BUCKET,
      Key: 'participants.json',
    }));
    const bodyStr = await s3Resp.Body?.transformToString();
    participants = JSON.parse(bodyStr || '[]');
  } catch (err) {
    console.error('Failed to read participants list from S3:', err);
    throw new Error('Participant list unavailable');
  }

  // 3. Case-insensitive compare
  const isEligible = participants.some(p => p.toLowerCase() === email.toLowerCase());

  if (!isEligible) {
    throw new Error('Not in participant list');
  }

  // 4. Success
  return event;
};
