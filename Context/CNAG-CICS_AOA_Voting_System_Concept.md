# CNAG-CICS AOA Voting System
### Project Concept Document
**Organization:** CNAG-CICS (College of Information and Computing Sciences)
**University:** University of Santo Tomas (UST)
**Document Type:** Concept & Architecture Overview
**Revision:** v2.0 — Improved Roadmap
**Prepared by:** Senior Cloud Solutions Architect
**Date:** May 2026

---

## 1. Executive Summary

The CNAG-CICS AOA Voting System is a **high-integrity, serverless digital governance platform** built on AWS, designed to facilitate the ratification of the organization's Articles of Association (AOA) during the General Assembly (GA). The system replaces or augments traditional paper-based voting with a cryptographically secured, fully auditable digital process that satisfies the requirements of the UST Office of Student Affairs (OSA) and the organization's Commission on Elections (COMELEC).

The platform is not merely a "voting website." It is a **legally defensible governance instrument** — one that produces an immutable, independently verifiable audit trail and protects the organization from accusations of electoral bias or data manipulation.

---

## 2. Problem Statement

Student organization elections and ratification processes face several recurring challenges:

- **Manual counting** is slow, error-prone, and difficult to audit after the fact.
- **Quorum verification** in large assemblies is cumbersome and open to dispute.
- **No audit trail** means that any challenge to results is difficult to resolve objectively.
- **Secret ballot integrity** — ensuring a vote cannot be traced back to an individual — is hard to guarantee with paper systems that pass through multiple hands.
- **Institutional compliance** — the UST OSA and internal COMELEC require documented proof of fair process before results are officially recognized.

This project addresses all five challenges through architecture, not policy.

---

## 3. Goals & Success Criteria

| Goal | Success Criterion |
|---|---|
| Legal defensibility | Digital Ratification Amendment ratified before Phase 1 dev begins |
| Voter authentication | Only verified @ust.edu.ph accounts on the Official Participant List can vote |
| Secret ballot | No record in any database can link a specific vote to a specific student |
| Immutable audit trail | CloudTrail logs and results exported to WORM storage before teardown |
| Quorum visibility | Real-time quorum percentage visible to COMELEC during the GA |
| Cost | Total AWS spend under ₱500 (~$8.50) for the full event lifecycle |
| Zero residual footprint | All compute infrastructure torn down within 48 hours of the GA |

---

## 4. Scope

### In Scope
- Voter registration and @ust.edu.ph domain verification
- Cross-reference against the Official Participant List
- Secure, anonymous vote casting for AOA ratification proposals
- Real-time quorum and results dashboard for COMELEC
- Post-election signed PDF audit report generation
- Immutable log archival (CloudTrail, DynamoDB exports)
- Infrastructure-as-Code (IaC) provisioning and teardown

### Out of Scope
- Multi-election support (this system is purpose-built for one GA session)
- Integration with UST's central student information system (manual list upload instead)
- Preferential or ranked-choice voting (binary yes/no ratification only)
- Physical fallback voting infrastructure

---

## 5. Architecture Overview

### 5.1 Core Stack

The system is built entirely on AWS serverless services to minimize cost, operational overhead, and attack surface.

```
Frontend (Amplify Hosting)
    └── AWS Amplify (React SPA, static hosting, CI/CD)

Authentication Layer
    └── Amazon Cognito User Pools
         ├── Domain restriction: @ust.edu.ph only
         └── Pre-signup Lambda trigger → Official Participant List check (S3)

API Layer
    └── Amazon API Gateway (REST)
         ├── Cognito JWT authorizer
         ├── Usage plan: max 10 req/sec per user
         └── AWS WAF: rate-based rules, IP flood protection

Compute Layer
    └── AWS Lambda
         ├── VoteSubmitFunction (idempotent, conditional DynamoDB write)
         ├── QuorumQueryFunction (read-only, aggregated count)
         └── AuditReportFunction (post-election, KMS-signed PDF)

Data Layer
    └── Amazon DynamoDB (on-demand)
         ├── HasVotedTable  { voterId: HMAC-SHA256(studentId, secret) }
         └── ResultsTable   { proposalId, voteChoice, timestamp }
         Both tables: PITR enabled, DynamoDB Streams → backup replica

Storage & Archival
    └── Amazon S3
         ├── participant-list/ (versioned, Object Lock COMPLIANCE mode)
         ├── audit-reports/   (Object Lock COMPLIANCE, 1-year retention)
         └── cloudtrail-logs/ (Object Lock COMPLIANCE, 1-year retention)

Secrets Management
    └── AWS Secrets Manager
         └── HMAC signing key (rotated and deleted post-event)

Observability
    └── AWS X-Ray          (end-to-end request tracing)
    └── Amazon CloudWatch  (dashboard: quorum %, latency p99, error rate)
    └── Amazon SNS         (alerts: unauthorized DB writes, console logins, error spikes)
    └── AWS CloudTrail     (all API and console activity, exported to WORM S3)

Infrastructure
    └── AWS CloudFormation / CDK (all resources IaC-managed)
    └── AWS Systems Manager Parameter Store (voting window open/close flag)
    └── AWS Budgets (alert at ₱500 spend threshold)
```

### 5.2 Cryptographic Ballot Separation

The system's privacy guarantee rests on the architectural separation of **identity** and **vote**:

```
Student submits vote
        │
        ▼
HMAC-SHA256(studentId, secret) ──→ HasVotedTable { hmac_id, timestamp }
                                   (proves participation, no vote content)

vote content ──────────────────→ ResultsTable { proposalId, voteChoice, timestamp }
                                   (proves vote, no voter identity)

secret key ────────────────────→ AWS Secrets Manager
                                   (deleted after event; breaks link permanently)
```

No join is possible between the two tables without the secret key. Once the key is deleted, the separation is permanent and irreversible.

### 5.3 Voting Window Control

The voting window is controlled by a **Parameter Store flag** — not a console action or a code deployment. This means:

- No one logs into AWS during a live election to "open" or "close" voting.
- The COMELEC head instructs the Faculty Adviser to flip the flag via a pre-built CLI command.
- Every Lambda function reads this flag on each invocation — no restart required.
- Any attempt to manipulate the flag outside of the authorized account generates a CloudTrail event and SNS alert.

---

## 6. Security Model

### Threat Model Summary

| Threat | Mitigation |
|---|---|
| Non-member votes | Cognito + @ust.edu.ph domain + Participant List Lambda check |
| Double voting | Conditional DynamoDB write (attribute_not_exists); idempotent 409 response |
| Vote tracing | HMAC cryptographic separation; secret key deleted post-event |
| Log tampering | S3 Object Lock COMPLIANCE mode; CloudTrail enabled throughout |
| Admin abuse | SCPs prevent disabling CloudTrail or deleting WORM buckets; Audit role read-only during event |
| Brute-force ID enumeration | HMAC-SHA256 with server-side secret (not plain hash) |
| Flood/stuffing | API Gateway usage plan + AWS WAF rate-based rules |
| Participant list manipulation | S3 versioned, WORM-locked; checksum recorded in audit report |

### IAM Role Hierarchy

```
Root account
    └── [SCP: cannot disable CloudTrail, cannot delete WORM buckets]

Developer role
    └── Read/write: Lambda, DynamoDB, Amplify
    └── No access: Results table during voting window, CloudTrail, S3 WORM

VoteLambda execution role
    └── Write: HasVotedTable (conditional), ResultsTable
    └── Read: Parameter Store (window flag), Secrets Manager (HMAC key), S3 (participant list)
    └── No access: everything else

Audit role (Faculty Adviser / OSA)
    └── Read-only: all tables, CloudTrail, S3 audit bucket
    └── Write: none during event window

```

---

## 7. Data Privacy & Compliance

### Secret Ballot Guarantee
Philippine student organization governance frameworks and general democratic principles require that individual votes remain secret. This system satisfies that requirement through cryptographic means, not policy alone:

1. The `HasVotedTable` contains only an HMAC of the student ID — not the ID itself.
2. The `ResultsTable` contains only the vote — not any voter identifier.
3. The HMAC secret is stored in Secrets Manager and deleted after the event.
4. The deletion of the secret makes the separation permanent — even the system's own developers cannot reconstruct who voted for what.

### OSA Compliance Requirements Met
- University-authenticated credentials (UST Email via Cognito)
- Immutable audit trail of participation (HasVotedTable + CloudTrail)
- Anonymity of individual ballot (cryptographic separation)
- Verifiable quorum count (anonymized participant list in audit report)
- Signed, tamper-evident results document (KMS-signed PDF)

---

## 8. Phased Roadmap Summary

### Phase 0 — Legal & Governance Clearance *(Hard Blocker)*
Secure written alignment from UST OSA and COMELEC. Ratify the Digital Ratification Amendment. Define the dispute resolution SOP in writing. **No development begins until this phase is complete.**

### Phase 1 — Architecture & Compliance *(~1 week)*
Provision the serverless stack via IaC (CDK/CloudFormation). Configure IAM least-privilege + SCPs. Enable DynamoDB PITR and backup replication. Set AWS Budgets alert at ₱500.

### Phase 2 — Authentication & Voter Integrity *(~1 week)*
Implement Cognito User Pool with domain restriction. Build the Participant List verification Lambda (S3-backed, versioned). Implement HMAC-SHA256 ballot separation. Wire idempotent conditional DynamoDB writes.

### Phase 3 — Development & Observability *(~2 weeks)*
Instrument all Lambdas with X-Ray. Build CloudWatch dashboard (quorum %, latency p99, error rate). Configure SNS alerts with precise trigger definitions. Add API Gateway usage plans + WAF. Build offline-resilient frontend vote submission UX.

### Phase 4 — Audit-Ready Output *(~1 week)*
Build the Lambda-triggered, KMS-signed PDF audit report generator. Configure CloudTrail → S3 WORM export (COMPLIANCE mode). Run a pre-event audit dry run 72 hours before the GA.

### Phase 5 — Execution & Decommission *(Event day + 48h)*
Load test at 1.5× peak concurrent users. Execute the GA using Parameter Store window control. Generate and archive the signed audit report. Verify all artifacts in WORM storage before running CloudFormation teardown.

---

## 9. Audit Report Contents

The post-election PDF report, generated automatically and signed via AWS KMS, must include:

1. **Event metadata** — organization name, GA date, voting window open/close timestamps
2. **Participant List provenance** — S3 version ID and SHA-256 checksum of the list used at verification
3. **Quorum verification** — total eligible members, total participants (anonymized HMAC IDs), quorum percentage
4. **Results** — per-proposal vote counts (yes/no/abstain), 2/3 majority threshold met/not met
5. **Integrity proof** — DynamoDB table checksum at close of voting window
6. **HMAC key fingerprint** — not the key itself; confirms cryptographic chain without exposing the secret
7. **CloudTrail summary** — count of administrative events during the voting window; any anomalies flagged
8. **KMS signature block** — cryptographic proof the report was generated by the authorized system

---

## 10. Cost Estimate

| Service | Usage | Estimated Cost |
|---|---|---|
| AWS Lambda | ~1,000 invocations | Free tier |
| Amazon DynamoDB | On-demand, ~500 writes | < $0.01 |
| Amazon Cognito | < 50,000 MAUs | Free tier |
| AWS Amplify Hosting | Static site | Free tier |
| Amazon API Gateway | ~1,000 requests | Free tier |
| AWS X-Ray | ~1,000 traces | ~$0.005 |
| Amazon CloudWatch | Dashboard + metrics | ~$0.30 |
| Amazon SNS | < 100 SMS (alert only) | ~$0.10 |
| AWS CloudTrail | 1 trail, S3 export | ~$0.10 |
| Amazon S3 | < 1 GB (logs + reports) | ~$0.02 |
| AWS WAF | ~$5/month (pro-rated) | ~$0.50 |
| AWS Secrets Manager | 1 secret, 1 month | ~$0.40 |
| **Total Estimate** | | **< $2.00 USD** |

> Budget alert set at ₱500 (~$8.50) via AWS Budgets as a guard rail.

---

## 11. The Digital Ratification Amendment

The following text is proposed for adoption at the May 30 General Assembly before voting commences:

> *"The organization recognizes the use of digital platforms for the ratification of the Articles of Association (AOA), provided said platform utilizes University-authenticated credentials (UST Email), maintains an immutable audit trail of participation, and ensures the anonymity of the individual ballot through cryptographic separation of identity and vote data."*

This amendment establishes the legal basis within the organization's governance framework for the digital voting process. It is the single most important prerequisite for the entire system's legitimacy.

---

## 12. Glossary

| Term | Definition |
|---|---|
| AOA | Articles of Association — the foundational governance document of the organization |
| COMELEC | Commission on Elections — the internal body overseeing the election process |
| OSA | Office of Student Affairs — the UST administrative body that must recognize results |
| HMAC | Hash-based Message Authentication Code — a cryptographic function that produces a keyed hash |
| PITR | Point-in-Time Recovery — a DynamoDB feature enabling restoration to any second within a 35-day window |
| WORM | Write Once, Read Many — a storage policy enforced by S3 Object Lock that prevents modification or deletion |
| SCP | Service Control Policy — an AWS Organizations policy that sets permission guardrails above IAM |
| IaC | Infrastructure as Code — managing cloud resources through version-controlled configuration files |
| KMS | AWS Key Management Service — used here to cryptographically sign the audit PDF |
| Quorum | The minimum number of eligible members required to be present for a vote to be valid |
| Idempotent | A property of an operation where performing it multiple times produces the same result as performing it once |

---

*This document is a living artifact. It should be updated as architectural decisions are finalized and as OSA or COMELEC requirements are clarified.*

*Prepared for internal use by the CNAG-CICS organization. Not for public distribution.*
