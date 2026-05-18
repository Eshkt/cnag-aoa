# S3 Buckets
resource "aws_s3_bucket" "audit_archive" {
  bucket = "audit-archive-bucket-${var.account_id}"
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit_archive.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 365
    }
  }
}

resource "aws_s3_bucket" "participant_list" {
  bucket = "participant-list-bucket-${var.account_id}"
}

resource "aws_s3_bucket_versioning" "participants" {
  bucket = aws_s3_bucket.participant_list.id
  versioning_configuration { status = "Enabled" }
}

# DynamoDB
resource "aws_dynamodb_table" "has_voted" {
  name           = "HasVotedTable-${var.account_id}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "voterId"
  point_in_time_recovery { enabled = true }
  attribute { name = "voterId"; type = "S" }
}

resource "aws_dynamodb_table" "results" {
  name           = "ResultsTable-${var.account_id}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "proposalId"
  range_key      = "voteId"
  point_in_time_recovery { enabled = true }
  attribute { name = "proposalId"; type = "S" }
  attribute { name = "voteId"; type = "S" }
}

# SSM & Secret
resource "aws_ssm_parameter" "window_open" {
  name  = "/voting/window-open"
  type  = "String"
  value = "false"
}

resource "aws_secretsmanager_secret" "hmac_key" {
  name = "hmac-signing-key-${var.account_id}"
}

# Cognito
resource "aws_cognito_user_pool" "pool" {
  name = "aoa-voting-user-pool"
  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
  }
  lambda_config {
    pre_sign_up = aws_lambda_function.fn["PreSignup"].arn
  }
}

resource "aws_cognito_user_pool_client" "client" {
  name            = "AoaUserPoolClient"
  user_pool_id    = aws_cognito_user_pool.pool.id
  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ADMIN_NO_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
}

# API Gateway
resource "aws_api_gateway_rest_api" "api" {
  name = "AOA Voting API"
}

resource "aws_api_gateway_authorizer" "auth" {
  name          = "AoaAuthorizer"
  rest_api_id   = aws_api_gateway_rest_api.api.id
  type          = "COGNITO_USER_POOLS"
  provider_arns = [aws_cognito_user_pool.pool.arn]
}

# Resources & Methods
resource "aws_api_gateway_resource" "vote" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "vote"
}

resource "aws_api_gateway_method" "post_vote" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.vote.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.auth.id
}

resource "aws_api_gateway_integration" "vote_lambda" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.vote.id
  http_method = aws_api_gateway_method.post_vote.http_method
  type        = "AWS_PROXY"
  integration_http_method = "POST"
  uri         = aws_lambda_function.fn["SubmitVote"].invoke_arn
}

resource "aws_api_gateway_resource" "status" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "status"
}

resource "aws_api_gateway_method" "get_status" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.status.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "status_lambda" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.status.id
  http_method = aws_api_gateway_method.get_status.http_method
  type        = "AWS_PROXY"
  integration_http_method = "POST"
  uri         = aws_lambda_function.fn["Status"].invoke_arn
}

resource "aws_api_gateway_resource" "results" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "results"
}

resource "aws_api_gateway_method" "get_results" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.results.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "results_lambda" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.results.id
  http_method = aws_api_gateway_method.get_results.http_method
  type        = "AWS_PROXY"
  integration_http_method = "POST"
  uri         = aws_lambda_function.fn["Results"].invoke_arn
}

# Deployment & Stage
resource "aws_api_gateway_deployment" "deploy" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  depends_on = [
    aws_api_gateway_integration.vote_lambda,
    aws_api_gateway_integration.status_lambda,
    aws_api_gateway_integration.results_lambda
  ]
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.deploy.id
  rest_api_id   = aws_api_gateway_rest_api.api.id
  stage_name    = "prod"
}

# WAF
resource "aws_wafv2_web_acl" "waf" {
  name  = "AoaWaf"
  scope = "REGIONAL"
  default_action { allow {} }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "AoaWaf"
    sampled_requests_enabled   = true
  }
  rule {
    name     = "RateLimit"
    priority = 1
    action { block {} }
    statement {
      rate_based_statement {
        limit              = 100
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimit"
      sampled_requests_enabled   = true
    }
  }
}

resource "aws_wafv2_web_acl_association" "api_waf" {
  resource_arn = aws_api_gateway_stage.prod.arn
  web_acl_arn  = aws_wafv2_web_acl.waf.arn
}

# Monitoring
resource "aws_sns_topic" "alerts" {
  name = "AoaAlerts"
}

resource "aws_sns_topic_subscription" "sms" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "sms"
  endpoint  = var.comelec_phone_number
}

resource "aws_cloudwatch_metric_alarm" "submit_vote_errors" {
  alarm_name          = "SubmitVoteErrorRateAlarm"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0.1
  alarm_description   = "SubmitVote Lambda error rate exceeds 10%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions = {
    FunctionName = aws_lambda_function.fn["SubmitVote"].function_name
  }
}
