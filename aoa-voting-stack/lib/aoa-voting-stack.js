"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AoaVotingStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const iam = require("aws-cdk-lib/aws-iam");
const aws_dynamodb_1 = require("aws-cdk-lib/aws-dynamodb");
const aws_s3_1 = require("aws-cdk-lib/aws-s3");
const aws_ssm_1 = require("aws-cdk-lib/aws-ssm");
const aws_cognito_1 = require("aws-cdk-lib/aws-cognito");
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_apigateway_1 = require("aws-cdk-lib/aws-apigateway");
const aws_wafv2_1 = require("aws-cdk-lib/aws-wafv2");
const aws_secretsmanager_1 = require("aws-cdk-lib/aws-secretsmanager");
const aws_cloudtrail_1 = require("aws-cdk-lib/aws-cloudtrail");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_sns_1 = require("aws-cdk-lib/aws-sns");
const aws_sns_subscriptions_1 = require("aws-cdk-lib/aws-sns-subscriptions");
const aws_cloudwatch_1 = require("aws-cdk-lib/aws-cloudwatch");
const aws_cloudwatch_actions_1 = require("aws-cdk-lib/aws-cloudwatch-actions");
const aws_cdk_lib_2 = require("aws-cdk-lib");
class AoaVotingStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Audit Archive Bucket with Object Lock
        const auditBucket = new aws_s3_1.Bucket(this, 'AuditArchiveBucket', {
            bucketName: 'audit-archive-bucket-804887692450',
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN,
            blockPublicAccess: aws_s3_1.BlockPublicAccess.BLOCK_ALL,
            objectLockEnabled: true,
            objectLockDefaultRetention: aws_s3_1.ObjectLockRetention.compliance(aws_cdk_lib_1.Duration.days(365)),
        });
        // Participant List Bucket
        const participantBucket = new aws_s3_1.Bucket(this, 'ParticipantListBucket', {
            bucketName: 'participant-list-bucket-804887692450',
            versioned: true,
            blockPublicAccess: aws_s3_1.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN,
        });
        // Table 1: HasVotedTable - tracks which voters have voted
        const hasVotedTable = new aws_dynamodb_1.Table(this, 'HasVotedTable', {
            tableName: 'HasVotedTable-804887692450',
            partitionKey: { name: 'voterId', type: aws_dynamodb_1.AttributeType.STRING },
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            pointInTimeRecovery: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN,
        });
        // Table 2: ResultsTable - stores votes with proposal and vote IDs
        const resultsTable = new aws_dynamodb_1.Table(this, 'ResultsTable', {
            tableName: 'ResultsTable-804887692450',
            partitionKey: { name: 'proposalId', type: aws_dynamodb_1.AttributeType.STRING },
            sortKey: { name: 'voteId', type: aws_dynamodb_1.AttributeType.STRING },
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            pointInTimeRecovery: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN,
        });
        // Voting window parameter
        const windowParam = new aws_ssm_1.StringParameter(this, 'VotingWindowParameter', {
            parameterName: '/voting/window-open',
            stringValue: 'false',
            description: 'controls voting window. set to true to open, false to close.',
        });
        // HMAC Secret
        const hmacSecret = aws_secretsmanager_1.Secret.fromSecretNameV2(this, 'HmacSecret', 'hmac-signing-key-804887692450');
        // Lambdas
        const preSignupLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'PreSignupChecker', {
            entry: 'src/pre-signup-checker/pre-signup-checker.ts',
            runtime: aws_lambda_1.Runtime.NODEJS_20_X,
            environment: { PARTICIPANT_BUCKET: participantBucket.bucketName },
        });
        participantBucket.grantRead(preSignupLambda);
        const submitVoteLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'SubmitVoteFunction', {
            entry: 'src/submit-vote/submit-vote.ts',
            runtime: aws_lambda_1.Runtime.NODEJS_20_X,
        });
        hasVotedTable.grantReadWriteData(submitVoteLambda);
        resultsTable.grantWriteData(submitVoteLambda);
        hmacSecret.grantRead(submitVoteLambda);
        windowParam.grantRead(submitVoteLambda);
        const statusLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'StatusFunction', {
            entry: 'src/status/status.ts',
            runtime: aws_lambda_1.Runtime.NODEJS_20_X,
        });
        hasVotedTable.grantReadWriteData(statusLambda);
        windowParam.grantRead(statusLambda);
        const resultsLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'ResultsFunction', {
            entry: 'src/results/results.ts',
            runtime: aws_lambda_1.Runtime.NODEJS_20_X,
        });
        resultsTable.grantReadData(resultsLambda);
        const auditLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'AuditReportFunction', {
            entry: 'src/generate-audit-report/generate-audit-report.ts',
            runtime: aws_lambda_1.Runtime.NODEJS_20_X,
            timeout: aws_cdk_lib_1.Duration.minutes(1),
            environment: {
                PARTICIPANT_BUCKET: participantBucket.bucketName,
                AUDIT_BUCKET: auditBucket.bucketName,
            },
        });
        hasVotedTable.grantReadData(auditLambda);
        resultsTable.grantReadData(auditLambda);
        participantBucket.grantRead(auditLambda);
        auditBucket.grantReadWrite(auditLambda);
        const toggleWindowLambda = new aws_lambda_nodejs_1.NodejsFunction(this, 'ToggleWindowFunction', {
            entry: 'src/toggle-window/toggle-window.ts',
            runtime: aws_lambda_1.Runtime.NODEJS_20_X,
        });
        windowParam.grantRead(toggleWindowLambda);
        // Needs write too
        const windowParamArn = `arn:aws:ssm:${this.region}:${this.account}:parameter/voting/window-open`;
        toggleWindowLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ssm:PutParameter'],
            resources: [windowParamArn],
        }));
        // Cognito
        const userPool = new aws_cognito_1.UserPool(this, 'AoaUserPool', {
            userPoolName: 'aoa-voting-user-pool',
            selfSignUpEnabled: false,
            signInAliases: { email: true },
            autoVerify: { email: true },
            passwordPolicy: { minLength: 8, requireLowercase: true, requireUppercase: true, requireDigits: true },
            lambdaTriggers: { preSignUp: preSignupLambda },
        });
        const userPoolClient = userPool.addClient('AoaUserPoolClient', {
            generateSecret: false,
            authFlows: { userSrp: true },
            enableTokenRevocation: true,
        });
        // Cast to any to force enable admin auth flow if type is missing or use direct override
        userPoolClient.node.defaultChild.explicitAuthFlows = ['ALLOW_USER_SRP_AUTH', 'ALLOW_ADMIN_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'];
        // API Gateway
        const api = new aws_apigateway_1.RestApi(this, 'AoaApi', { restApiName: 'AOA Voting API' });
        const authorizer = new aws_apigateway_1.CognitoUserPoolsAuthorizer(this, 'AoaAuthorizer', { cognitoUserPools: [userPool] });
        const voteRes = api.root.addResource('vote');
        voteRes.addMethod('POST', new aws_apigateway_1.LambdaIntegration(submitVoteLambda), { authorizer, authorizationType: aws_apigateway_1.AuthorizationType.COGNITO });
        const statusRes = api.root.addResource('status');
        statusRes.addMethod('GET', new aws_apigateway_1.LambdaIntegration(statusLambda));
        const resultsRes = api.root.addResource('results');
        resultsRes.addMethod('GET', new aws_apigateway_1.LambdaIntegration(resultsLambda), { authorizer, authorizationType: aws_apigateway_1.AuthorizationType.COGNITO });
        const adminRes = api.root.addResource('admin');
        adminRes.addResource('generate-report').addMethod('POST', new aws_apigateway_1.LambdaIntegration(auditLambda), { authorizer, authorizationType: aws_apigateway_1.AuthorizationType.COGNITO });
        adminRes.addResource('toggle-window').addMethod('POST', new aws_apigateway_1.LambdaIntegration(toggleWindowLambda), { authorizer, authorizationType: aws_apigateway_1.AuthorizationType.COGNITO });
        const plan = api.addUsagePlan('AoaUsagePlan', { throttle: { rateLimit: 10, burstLimit: 20 } });
        plan.addApiStage({ stage: api.deploymentStage });
        // WAF
        const waf = new aws_wafv2_1.CfnWebACL(this, 'AoaWaf', {
            defaultAction: { allow: {} },
            scope: 'REGIONAL',
            visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'AoaWafMetric', sampledRequestsEnabled: true },
            rules: [{
                    name: 'RateLimit',
                    priority: 1,
                    action: { block: {} },
                    statement: { rateBasedStatement: { limit: 100, aggregateKeyType: 'IP' } },
                    visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'AoaRateLimitMetric', sampledRequestsEnabled: true },
                }],
        });
        new aws_wafv2_1.CfnWebACLAssociation(this, 'AoaWafAssoc', {
            resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
            webAclArn: waf.attrArn,
        });
        // Monitoring & Alerting
        const trail = new aws_cloudtrail_1.Trail(this, 'AuditTrail', { bucket: auditBucket, managementEvents: aws_cloudtrail_1.ReadWriteType.ALL, sendToCloudWatchLogs: true });
        const alertTopic = new aws_sns_1.Topic(this, 'ComelecAlerts', { topicName: 'ComelecAlerts' });
        const phoneNumber = aws_ssm_1.StringParameter.valueForStringParameter(this, '/alerts/comelec-phone');
        alertTopic.addSubscription(new aws_sns_subscriptions_1.SmsSubscription(phoneNumber));
        const unauthorizedMutationMetric = trail.logGroup.addMetricFilter('UnauthorizedMutationFilter', {
            metricName: 'UnauthorizedResultsMutation',
            metricNamespace: 'AoaVoting/Security',
            filterPattern: aws_logs_1.FilterPattern.literal(`{ ($.eventName = "DeleteItem" || $.eventName = "UpdateItem") && ($.requestParameters.tableName = "${resultsTable.tableName}") && ($.userIdentity.arn != "${submitVoteLambda.role.roleArn}") }`),
        });
        new aws_cloudwatch_1.Alarm(this, 'UnauthorizedMutationAlarm', {
            metric: unauthorizedMutationMetric.metric(),
            threshold: 1,
            evaluationPeriods: 1,
            alarmDescription: 'Unauthorized manual deletion or update detected in ResultsTable',
            treatMissingData: aws_cloudwatch_1.TreatMissingData.NOT_BREACHING,
        }).addAlarmAction(new aws_cloudwatch_actions_1.SnsAction(alertTopic));
        const errorRate = new aws_cloudwatch_1.MathExpression({
            expression: 'errors / invocations',
            usingMetrics: {
                errors: submitVoteLambda.metricErrors({ period: aws_cdk_lib_1.Duration.minutes(5), statistic: 'Sum' }),
                invocations: submitVoteLambda.metricInvocations({ period: aws_cdk_lib_1.Duration.minutes(5), statistic: 'Sum' }),
            },
        });
        new aws_cloudwatch_1.Alarm(this, 'SubmitVoteErrorRateAlarm', {
            metric: errorRate,
            threshold: 0.1,
            evaluationPeriods: 1,
            comparisonOperator: aws_cloudwatch_1.ComparisonOperator.GREATER_THAN_THRESHOLD,
            alarmDescription: 'SubmitVote Lambda error rate exceeds 10% over 5 minutes',
            treatMissingData: aws_cloudwatch_1.TreatMissingData.NOT_BREACHING,
        }).addAlarmAction(new aws_cloudwatch_actions_1.SnsAction(alertTopic));
        // Outputs
        new aws_cdk_lib_2.CfnOutput(this, 'HasVotedTableName', { value: hasVotedTable.tableName });
        new aws_cdk_lib_2.CfnOutput(this, 'ResultsTableName', { value: resultsTable.tableName });
        new aws_cdk_lib_2.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
        new aws_cdk_lib_2.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
        new aws_cdk_lib_2.CfnOutput(this, 'ApiUrl', { value: api.url });
    }
}
exports.AoaVotingStack = AoaVotingStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW9hLXZvdGluZy1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFvYS12b3Rpbmctc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBQXlFO0FBQ3pFLDJDQUEyQztBQUMzQywyREFBNkU7QUFDN0UsK0NBQW9GO0FBQ3BGLGlEQUFzRDtBQUN0RCx5REFBMkU7QUFDM0UscUVBQStEO0FBQy9ELHVEQUFpRDtBQUNqRCwrREFBdUg7QUFDdkgscURBQXdFO0FBQ3hFLHVFQUF3RDtBQUN4RCwrREFBa0U7QUFDbEUsbURBQXFEO0FBQ3JELGlEQUE0QztBQUM1Qyw2RUFBb0U7QUFDcEUsK0RBQXlHO0FBQ3pHLCtFQUErRDtBQUUvRCw2Q0FBd0M7QUFFeEMsTUFBYSxjQUFlLFNBQVEsbUJBQUs7SUFDdkMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFrQjtRQUMxRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qix3Q0FBd0M7UUFDeEMsTUFBTSxXQUFXLEdBQUcsSUFBSSxlQUFNLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQ3pELFVBQVUsRUFBRSxtQ0FBbUM7WUFDL0MsYUFBYSxFQUFFLDJCQUFhLENBQUMsTUFBTTtZQUNuQyxpQkFBaUIsRUFBRSwwQkFBaUIsQ0FBQyxTQUFTO1lBQzlDLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsMEJBQTBCLEVBQUUsNEJBQW1CLENBQUMsVUFBVSxDQUFDLHNCQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1NBQy9FLENBQUMsQ0FBQztRQUVILDBCQUEwQjtRQUMxQixNQUFNLGlCQUFpQixHQUFHLElBQUksZUFBTSxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUNsRSxVQUFVLEVBQUUsc0NBQXNDO1lBQ2xELFNBQVMsRUFBRSxJQUFJO1lBQ2YsaUJBQWlCLEVBQUUsMEJBQWlCLENBQUMsU0FBUztZQUM5Qyxh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LHdDQTZNQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFN0YWNrLCBTdGFja1Byb3BzLCBSZW1vdmFsUG9saWN5LCBEdXJhdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCB7IFRhYmxlLCBCaWxsaW5nTW9kZSwgQXR0cmlidXRlVHlwZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgeyBCdWNrZXQsIE9iamVjdExvY2tSZXRlbnRpb24sIEJsb2NrUHVibGljQWNjZXNzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCB7IFN0cmluZ1BhcmFtZXRlciB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zc20nO1xuaW1wb3J0IHsgVXNlclBvb2wsIFZlcmlmaWNhdGlvbkVtYWlsU3R5bGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCB7IFJ1bnRpbWUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IFJlc3RBcGksIExhbWJkYUludGVncmF0aW9uLCBBdXRob3JpemF0aW9uVHlwZSwgQ29nbml0b1VzZXJQb29sc0F1dGhvcml6ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgeyBDZm5XZWJBQ0wsIENmbldlYkFDTEFzc29jaWF0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXdhZnYyJztcbmltcG9ydCB7IFNlY3JldCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgeyBUcmFpbCwgUmVhZFdyaXRlVHlwZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHRyYWlsJztcbmltcG9ydCB7IEZpbHRlclBhdHRlcm4gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBUb3BpYyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0IHsgU21zU3Vic2NyaXB0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucy1zdWJzY3JpcHRpb25zJztcbmltcG9ydCB7IEFsYXJtLCBDb21wYXJpc29uT3BlcmF0b3IsIFRyZWF0TWlzc2luZ0RhdGEsIE1hdGhFeHByZXNzaW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnO1xuaW1wb3J0IHsgU25zQWN0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gtYWN0aW9ucyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IENmbk91dHB1dCB9IGZyb20gJ2F3cy1jZGstbGliJztcblxuZXhwb3J0IGNsYXNzIEFvYVZvdGluZ1N0YWNrIGV4dGVuZHMgU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIEF1ZGl0IEFyY2hpdmUgQnVja2V0IHdpdGggT2JqZWN0IExvY2tcbiAgICBjb25zdCBhdWRpdEJ1Y2tldCA9IG5ldyBCdWNrZXQodGhpcywgJ0F1ZGl0QXJjaGl2ZUJ1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6ICdhdWRpdC1hcmNoaXZlLWJ1Y2tldC04MDQ4ODc2OTI0NTAnLFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgb2JqZWN0TG9ja0VuYWJsZWQ6IHRydWUsXG4gICAgICBvYmplY3RMb2NrRGVmYXVsdFJldGVudGlvbjogT2JqZWN0TG9ja1JldGVudGlvbi5jb21wbGlhbmNlKER1cmF0aW9uLmRheXMoMzY1KSksXG4gICAgfSk7XG5cbiAgICAvLyBQYXJ0aWNpcGFudCBMaXN0IEJ1Y2tldFxuICAgIGNvbnN0IHBhcnRpY2lwYW50QnVja2V0ID0gbmV3IEJ1Y2tldCh0aGlzLCAnUGFydGljaXBhbnRMaXN0QnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogJ3BhcnRpY2lwYW50LWxpc3QtYnVja2V0LTgwNDg4NzY5MjQ1MCcsXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgfSk7XG5cbiAgICAvLyBUYWJsZSAxOiBIYXNWb3RlZFRhYmxlIC0gdHJhY2tzIHdoaWNoIHZvdGVycyBoYXZlIHZvdGVkXG4gICAgY29uc3QgaGFzVm90ZWRUYWJsZSA9IG5ldyBUYWJsZSh0aGlzLCAnSGFzVm90ZWRUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ0hhc1ZvdGVkVGFibGUtODA0ODg3NjkyNDUwJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndm90ZXJJZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgIH0pO1xuXG4gICAgLy8gVGFibGUgMjogUmVzdWx0c1RhYmxlIC0gc3RvcmVzIHZvdGVzIHdpdGggcHJvcG9zYWwgYW5kIHZvdGUgSURzXG4gICAgY29uc3QgcmVzdWx0c1RhYmxlID0gbmV3IFRhYmxlKHRoaXMsICdSZXN1bHRzVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdSZXN1bHRzVGFibGUtODA0ODg3NjkyNDUwJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncHJvcG9zYWxJZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICd2b3RlSWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IEJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIC8vIFZvdGluZyB3aW5kb3cgcGFyYW1ldGVyXG4gICAgY29uc3Qgd2luZG93UGFyYW0gPSBuZXcgU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdWb3RpbmdXaW5kb3dQYXJhbWV0ZXInLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiAnL3ZvdGluZy93aW5kb3ctb3BlbicsXG4gICAgICBzdHJpbmdWYWx1ZTogJ2ZhbHNlJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnY29udHJvbHMgdm90aW5nIHdpbmRvdy4gc2V0IHRvIHRydWUgdG8gb3BlbiwgZmFsc2UgdG8gY2xvc2UuJyxcbiAgICB9KTtcblxuICAgIC8vIEhNQUMgU2VjcmV0XG4gICAgY29uc3QgaG1hY1NlY3JldCA9IFNlY3JldC5mcm9tU2VjcmV0TmFtZVYyKHRoaXMsICdIbWFjU2VjcmV0JywgJ2htYWMtc2lnbmluZy1rZXktODA0ODg3NjkyNDUwJyk7XG5cbiAgICAvLyBMYW1iZGFzXG4gICAgY29uc3QgcHJlU2lnbnVwTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdQcmVTaWdudXBDaGVja2VyJywge1xuICAgICAgZW50cnk6ICdzcmMvcHJlLXNpZ251cC1jaGVja2VyL3ByZS1zaWdudXAtY2hlY2tlci50cycsXG4gICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW52aXJvbm1lbnQ6IHsgUEFSVElDSVBBTlRfQlVDS0VUOiBwYXJ0aWNpcGFudEJ1Y2tldC5idWNrZXROYW1lIH0sXG4gICAgfSk7XG4gICAgcGFydGljaXBhbnRCdWNrZXQuZ3JhbnRSZWFkKHByZVNpZ251cExhbWJkYSk7XG5cbiAgICBjb25zdCBzdWJtaXRWb3RlTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdTdWJtaXRWb3RlRnVuY3Rpb24nLCB7XG4gICAgICBlbnRyeTogJ3NyYy9zdWJtaXQtdm90ZS9zdWJtaXQtdm90ZS50cycsXG4gICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMF9YLFxuICAgIH0pO1xuICAgIGhhc1ZvdGVkVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHN1Ym1pdFZvdGVMYW1iZGEpO1xuICAgIHJlc3VsdHNUYWJsZS5ncmFudFdyaXRlRGF0YShzdWJtaXRWb3RlTGFtYmRhKTtcbiAgICBobWFjU2VjcmV0LmdyYW50UmVhZChzdWJtaXRWb3RlTGFtYmRhKTtcbiAgICB3aW5kb3dQYXJhbS5ncmFudFJlYWQoc3VibWl0Vm90ZUxhbWJkYSk7XG5cbiAgICBjb25zdCBzdGF0dXNMYW1iZGEgPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgJ1N0YXR1c0Z1bmN0aW9uJywge1xuICAgICAgZW50cnk6ICdzcmMvc3RhdHVzL3N0YXR1cy50cycsXG4gICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMF9YLFxuICAgIH0pO1xuICAgIGhhc1ZvdGVkVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHN0YXR1c0xhbWJkYSk7XG4gICAgd2luZG93UGFyYW0uZ3JhbnRSZWFkKHN0YXR1c0xhbWJkYSk7XG5cbiAgICBjb25zdCByZXN1bHRzTGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdSZXN1bHRzRnVuY3Rpb24nLCB7XG4gICAgICBlbnRyeTogJ3NyYy9yZXN1bHRzL3Jlc3VsdHMudHMnLFxuICAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICB9KTtcbiAgICByZXN1bHRzVGFibGUuZ3JhbnRSZWFkRGF0YShyZXN1bHRzTGFtYmRhKTtcblxuICAgIGNvbnN0IGF1ZGl0TGFtYmRhID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdBdWRpdFJlcG9ydEZ1bmN0aW9uJywge1xuICAgICAgZW50cnk6ICdzcmMvZ2VuZXJhdGUtYXVkaXQtcmVwb3J0L2dlbmVyYXRlLWF1ZGl0LXJlcG9ydC50cycsXG4gICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFBBUlRJQ0lQQU5UX0JVQ0tFVDogcGFydGljaXBhbnRCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgQVVESVRfQlVDS0VUOiBhdWRpdEJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBoYXNWb3RlZFRhYmxlLmdyYW50UmVhZERhdGEoYXVkaXRMYW1iZGEpO1xuICAgIHJlc3VsdHNUYWJsZS5ncmFudFJlYWREYXRhKGF1ZGl0TGFtYmRhKTtcbiAgICBwYXJ0aWNpcGFudEJ1Y2tldC5ncmFudFJlYWQoYXVkaXRMYW1iZGEpO1xuICAgIGF1ZGl0QnVja2V0LmdyYW50UmVhZFdyaXRlKGF1ZGl0TGFtYmRhKTtcblxuICAgIGNvbnN0IHRvZ2dsZVdpbmRvd0xhbWJkYSA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnVG9nZ2xlV2luZG93RnVuY3Rpb24nLCB7XG4gICAgICBlbnRyeTogJ3NyYy90b2dnbGUtd2luZG93L3RvZ2dsZS13aW5kb3cudHMnLFxuICAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICB9KTtcbiAgICB3aW5kb3dQYXJhbS5ncmFudFJlYWQodG9nZ2xlV2luZG93TGFtYmRhKTtcbiAgICAvLyBOZWVkcyB3cml0ZSB0b29cbiAgICBjb25zdCB3aW5kb3dQYXJhbUFybiA9IGBhcm46YXdzOnNzbToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cGFyYW1ldGVyL3ZvdGluZy93aW5kb3ctb3BlbmA7XG4gICAgdG9nZ2xlV2luZG93TGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ3NzbTpQdXRQYXJhbWV0ZXInXSxcbiAgICAgIHJlc291cmNlczogW3dpbmRvd1BhcmFtQXJuXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDb2duaXRvXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgVXNlclBvb2wodGhpcywgJ0FvYVVzZXJQb29sJywge1xuICAgICAgdXNlclBvb2xOYW1lOiAnYW9hLXZvdGluZy11c2VyLXBvb2wnLFxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IGZhbHNlLFxuICAgICAgc2lnbkluQWxpYXNlczogeyBlbWFpbDogdHJ1ZSB9LFxuICAgICAgYXV0b1ZlcmlmeTogeyBlbWFpbDogdHJ1ZSB9LFxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHsgbWluTGVuZ3RoOiA4LCByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLCByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLCByZXF1aXJlRGlnaXRzOiB0cnVlIH0sXG4gICAgICBsYW1iZGFUcmlnZ2VyczogeyBwcmVTaWduVXA6IHByZVNpZ251cExhbWJkYSB9LFxuICAgIH0pO1xuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50ID0gdXNlclBvb2wuYWRkQ2xpZW50KCdBb2FVc2VyUG9vbENsaWVudCcsIHtcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSxcbiAgICAgIGF1dGhGbG93czogeyB1c2VyU3JwOiB0cnVlIH0sXG4gICAgICBlbmFibGVUb2tlblJldm9jYXRpb246IHRydWUsXG4gICAgfSk7XG4gICAgLy8gQ2FzdCB0byBhbnkgdG8gZm9yY2UgZW5hYmxlIGFkbWluIGF1dGggZmxvdyBpZiB0eXBlIGlzIG1pc3Npbmcgb3IgdXNlIGRpcmVjdCBvdmVycmlkZVxuICAgICh1c2VyUG9vbENsaWVudC5ub2RlLmRlZmF1bHRDaGlsZCBhcyBhbnkpLmV4cGxpY2l0QXV0aEZsb3dzID0gWydBTExPV19VU0VSX1NSUF9BVVRIJywgJ0FMTE9XX0FETUlOX1VTRVJfUEFTU1dPUkRfQVVUSCcsICdBTExPV19SRUZSRVNIX1RPS0VOX0FVVEgnXTtcblxuICAgIC8vIEFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IFJlc3RBcGkodGhpcywgJ0FvYUFwaScsIHsgcmVzdEFwaU5hbWU6ICdBT0EgVm90aW5nIEFQSScgfSk7XG4gICAgY29uc3QgYXV0aG9yaXplciA9IG5ldyBDb2duaXRvVXNlclBvb2xzQXV0aG9yaXplcih0aGlzLCAnQW9hQXV0aG9yaXplcicsIHsgY29nbml0b1VzZXJQb29sczogW3VzZXJQb29sXSB9KTtcblxuICAgIGNvbnN0IHZvdGVSZXMgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgndm90ZScpO1xuICAgIHZvdGVSZXMuYWRkTWV0aG9kKCdQT1NUJywgbmV3IExhbWJkYUludGVncmF0aW9uKHN1Ym1pdFZvdGVMYW1iZGEpLCB7IGF1dGhvcml6ZXIsIGF1dGhvcml6YXRpb25UeXBlOiBBdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPIH0pO1xuXG4gICAgY29uc3Qgc3RhdHVzUmVzID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3N0YXR1cycpO1xuICAgIHN0YXR1c1Jlcy5hZGRNZXRob2QoJ0dFVCcsIG5ldyBMYW1iZGFJbnRlZ3JhdGlvbihzdGF0dXNMYW1iZGEpKTtcblxuICAgIGNvbnN0IHJlc3VsdHNSZXMgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgncmVzdWx0cycpO1xuICAgIHJlc3VsdHNSZXMuYWRkTWV0aG9kKCdHRVQnLCBuZXcgTGFtYmRhSW50ZWdyYXRpb24ocmVzdWx0c0xhbWJkYSksIHsgYXV0aG9yaXplciwgYXV0aG9yaXphdGlvblR5cGU6IEF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8gfSk7XG5cbiAgICBjb25zdCBhZG1pblJlcyA9IGFwaS5yb290LmFkZFJlc291cmNlKCdhZG1pbicpO1xuICAgIGFkbWluUmVzLmFkZFJlc291cmNlKCdnZW5lcmF0ZS1yZXBvcnQnKS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgTGFtYmRhSW50ZWdyYXRpb24oYXVkaXRMYW1iZGEpLCB7IGF1dGhvcml6ZXIsIGF1dGhvcml6YXRpb25UeXBlOiBBdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPIH0pO1xuICAgIGFkbWluUmVzLmFkZFJlc291cmNlKCd0b2dnbGUtd2luZG93JykuYWRkTWV0aG9kKCdQT1NUJywgbmV3IExhbWJkYUludGVncmF0aW9uKHRvZ2dsZVdpbmRvd0xhbWJkYSksIHsgYXV0aG9yaXplciwgYXV0aG9yaXphdGlvblR5cGU6IEF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8gfSk7XG5cbiAgICBjb25zdCBwbGFuID0gYXBpLmFkZFVzYWdlUGxhbignQW9hVXNhZ2VQbGFuJywgeyB0aHJvdHRsZTogeyByYXRlTGltaXQ6IDEwLCBidXJzdExpbWl0OiAyMCB9IH0pO1xuICAgIHBsYW4uYWRkQXBpU3RhZ2UoeyBzdGFnZTogYXBpLmRlcGxveW1lbnRTdGFnZSB9KTtcblxuICAgIC8vIFdBRlxuICAgIGNvbnN0IHdhZiA9IG5ldyBDZm5XZWJBQ0wodGhpcywgJ0FvYVdhZicsIHtcbiAgICAgIGRlZmF1bHRBY3Rpb246IHsgYWxsb3c6IHt9IH0sXG4gICAgICBzY29wZTogJ1JFR0lPTkFMJyxcbiAgICAgIHZpc2liaWxpdHlDb25maWc6IHsgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLCBtZXRyaWNOYW1lOiAnQW9hV2FmTWV0cmljJywgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSB9LFxuICAgICAgcnVsZXM6IFt7XG4gICAgICAgIG5hbWU6ICdSYXRlTGltaXQnLFxuICAgICAgICBwcmlvcml0eTogMSxcbiAgICAgICAgYWN0aW9uOiB7IGJsb2NrOiB7fSB9LFxuICAgICAgICBzdGF0ZW1lbnQ6IHsgcmF0ZUJhc2VkU3RhdGVtZW50OiB7IGxpbWl0OiAxMDAsIGFnZ3JlZ2F0ZUtleVR5cGU6ICdJUCcgfSB9LFxuICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7IGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSwgbWV0cmljTmFtZTogJ0FvYVJhdGVMaW1pdE1ldHJpYycsIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUgfSxcbiAgICAgIH1dLFxuICAgIH0pO1xuICAgIG5ldyBDZm5XZWJBQ0xBc3NvY2lhdGlvbih0aGlzLCAnQW9hV2FmQXNzb2MnLCB7XG4gICAgICByZXNvdXJjZUFybjogYGFybjphd3M6YXBpZ2F0ZXdheToke3RoaXMucmVnaW9ufTo6L3Jlc3RhcGlzLyR7YXBpLnJlc3RBcGlJZH0vc3RhZ2VzLyR7YXBpLmRlcGxveW1lbnRTdGFnZS5zdGFnZU5hbWV9YCxcbiAgICAgIHdlYkFjbEFybjogd2FmLmF0dHJBcm4sXG4gICAgfSk7XG5cbiAgICAvLyBNb25pdG9yaW5nICYgQWxlcnRpbmdcbiAgICBjb25zdCB0cmFpbCA9IG5ldyBUcmFpbCh0aGlzLCAnQXVkaXRUcmFpbCcsIHsgYnVja2V0OiBhdWRpdEJ1Y2tldCwgbWFuYWdlbWVudEV2ZW50czogUmVhZFdyaXRlVHlwZS5BTEwsIHNlbmRUb0Nsb3VkV2F0Y2hMb2dzOiB0cnVlIH0pO1xuICAgIGNvbnN0IGFsZXJ0VG9waWMgPSBuZXcgVG9waWModGhpcywgJ0NvbWVsZWNBbGVydHMnLCB7IHRvcGljTmFtZTogJ0NvbWVsZWNBbGVydHMnIH0pO1xuICAgIGNvbnN0IHBob25lTnVtYmVyID0gU3RyaW5nUGFyYW1ldGVyLnZhbHVlRm9yU3RyaW5nUGFyYW1ldGVyKHRoaXMsICcvYWxlcnRzL2NvbWVsZWMtcGhvbmUnKTtcbiAgICBhbGVydFRvcGljLmFkZFN1YnNjcmlwdGlvbihuZXcgU21zU3Vic2NyaXB0aW9uKHBob25lTnVtYmVyKSk7XG5cbiAgICBjb25zdCB1bmF1dGhvcml6ZWRNdXRhdGlvbk1ldHJpYyA9IHRyYWlsLmxvZ0dyb3VwIS5hZGRNZXRyaWNGaWx0ZXIoJ1VuYXV0aG9yaXplZE11dGF0aW9uRmlsdGVyJywge1xuICAgICAgbWV0cmljTmFtZTogJ1VuYXV0aG9yaXplZFJlc3VsdHNNdXRhdGlvbicsXG4gICAgICBtZXRyaWNOYW1lc3BhY2U6ICdBb2FWb3RpbmcvU2VjdXJpdHknLFxuICAgICAgZmlsdGVyUGF0dGVybjogRmlsdGVyUGF0dGVybi5saXRlcmFsKGB7ICgkLmV2ZW50TmFtZSA9IFwiRGVsZXRlSXRlbVwiIHx8ICQuZXZlbnROYW1lID0gXCJVcGRhdGVJdGVtXCIpICYmICgkLnJlcXVlc3RQYXJhbWV0ZXJzLnRhYmxlTmFtZSA9IFwiJHtyZXN1bHRzVGFibGUudGFibGVOYW1lfVwiKSAmJiAoJC51c2VySWRlbnRpdHkuYXJuICE9IFwiJHtzdWJtaXRWb3RlTGFtYmRhLnJvbGUhLnJvbGVBcm59XCIpIH1gKSxcbiAgICB9KTtcblxuICAgIG5ldyBBbGFybSh0aGlzLCAnVW5hdXRob3JpemVkTXV0YXRpb25BbGFybScsIHtcbiAgICAgIG1ldHJpYzogdW5hdXRob3JpemVkTXV0YXRpb25NZXRyaWMubWV0cmljKCksXG4gICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdVbmF1dGhvcml6ZWQgbWFudWFsIGRlbGV0aW9uIG9yIHVwZGF0ZSBkZXRlY3RlZCBpbiBSZXN1bHRzVGFibGUnLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pLmFkZEFsYXJtQWN0aW9uKG5ldyBTbnNBY3Rpb24oYWxlcnRUb3BpYykpO1xuXG4gICAgY29uc3QgZXJyb3JSYXRlID0gbmV3IE1hdGhFeHByZXNzaW9uKHtcbiAgICAgIGV4cHJlc3Npb246ICdlcnJvcnMgLyBpbnZvY2F0aW9ucycsXG4gICAgICB1c2luZ01ldHJpY3M6IHtcbiAgICAgICAgZXJyb3JzOiBzdWJtaXRWb3RlTGFtYmRhLm1ldHJpY0Vycm9ycyh7IHBlcmlvZDogRHVyYXRpb24ubWludXRlcyg1KSwgc3RhdGlzdGljOiAnU3VtJyB9KSxcbiAgICAgICAgaW52b2NhdGlvbnM6IHN1Ym1pdFZvdGVMYW1iZGEubWV0cmljSW52b2NhdGlvbnMoeyBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksIHN0YXRpc3RpYzogJ1N1bScgfSksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgbmV3IEFsYXJtKHRoaXMsICdTdWJtaXRWb3RlRXJyb3JSYXRlQWxhcm0nLCB7XG4gICAgICBtZXRyaWM6IGVycm9yUmF0ZSxcbiAgICAgIHRocmVzaG9sZDogMC4xLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IENvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ1N1Ym1pdFZvdGUgTGFtYmRhIGVycm9yIHJhdGUgZXhjZWVkcyAxMCUgb3ZlciA1IG1pbnV0ZXMnLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pLmFkZEFsYXJtQWN0aW9uKG5ldyBTbnNBY3Rpb24oYWxlcnRUb3BpYykpO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ0hhc1ZvdGVkVGFibGVOYW1lJywgeyB2YWx1ZTogaGFzVm90ZWRUYWJsZS50YWJsZU5hbWUgfSk7XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCAnUmVzdWx0c1RhYmxlTmFtZScsIHsgdmFsdWU6IHJlc3VsdHNUYWJsZS50YWJsZU5hbWUgfSk7XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xJZCcsIHsgdmFsdWU6IHVzZXJQb29sLnVzZXJQb29sSWQgfSk7XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHsgdmFsdWU6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQgfSk7XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCAnQXBpVXJsJywgeyB2YWx1ZTogYXBpLnVybCB9KTtcbiAgfVxufVxuIl19