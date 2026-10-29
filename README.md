# CNAG-CICS AOA Voting System

A high-integrity, serverless digital governance platform built on AWS, designed for the ratification of the CNAG-CICS (College of Information and Computing Sciences) Articles of Association (AOA) at the University of Santo Tomas (UST).

## 🚀 Overview

This system replaces traditional paper-based voting with a cryptographically secured, fully auditable digital process. It ensures voter integrity, ballot anonymity, and produces a legally defensible audit trail to satisfy institutional compliance requirements.

## 🏗️ Architecture

The system is built entirely on AWS serverless infrastructure to ensure scalability, security, and cost-efficiency.

### Tech Stack
- **Frontend:** React, TypeScript, Vite, AWS Amplify Hosting.
- **Authentication:** Amazon Cognito (Domain restricted to `@ust.edu.ph`).
- **API Layer:** Amazon API Gateway + AWS Lambda.
- **Database:** Amazon DynamoDB (On-demand).
- **Security:** AWS WAF, Secrets Manager (HMAC signing), IAM Least Privilege.
- **Audit & Compliance:** Amazon S3 (WORM storage/Object Lock), AWS CloudTrail, AWS KMS.

### Key Security Features
- **Cryptographic Ballot Separation:** Uses HMAC-SHA256 to decouple voter identity from the actual vote. Once the secret key is deleted post-event, the link is permanently broken.
- **Idempotent Voting:** Prevents double-voting via conditional DynamoDB writes.
- **Immutable Logs:** All administrative actions and audit reports are stored in S3 buckets with COMPLIANCE mode Object Lock.
- **Voting Window Control:** Controlled via AWS Systems Manager Parameter Store to avoid manual console intervention during live events.

## 📁 Project Structure

- `/amplify`: AWS Amplify Gen 2 backend definitions (Auth, Functions, Storage).
- `/aoa-voting-stack`: CDK-based infrastructure for auxiliary voting services (Audit reports, Status checks, etc.).
- `/Context`: Project concept and architecture documentation.
- `/public` & `/Assets`: Static assets and branding.

## 🛠️ Getting Started

### Prerequisites
- AWS Account
- Node.js (v18+)
- AWS CLI & Amplify CLI configured

### Development
1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Run development server:**
   ```bash
   npm run dev
   ```
3. **Amplify Sandbox (Backend):**
   ```bash
   npm run amplify:sandbox
   ```

### Deployment
- Use `npm run amplify:deploy` for the frontend and core backend.
- Use the `deploy.sh` script for full stack orchestration.

## ⚖️ Compliance & Ethics

This system is designed to meet the requirements of the UST Office of Student Affairs (OSA) and the internal Commission on Elections (COMELEC), ensuring:
- **Secret Ballot:** Guaranteed through architectural separation of identity and vote.
- **Verifiable Quorum:** Real-time tracking of eligible participant turnout.
- **Auditability:** Signed PDF reports generated post-election for institutional review.

---
*This project is developed for the CNAG-CICS organization.*
