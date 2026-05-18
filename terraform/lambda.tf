# IAM Roles for Lambdas
resource "aws_iam_role" "lambda_role" {
  name = "${var.stack_name}-LambdaRole"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "${var.stack_name}-LambdaPolicy"
  role = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Scan", "dynamodb:Query",
          "ssm:GetParameter", "ssm:PutParameter",
          "secretsmanager:GetSecretValue",
          "s3:PutObject", "s3:GetObject", "s3:ListBucket",
          "logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"
        ]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

# Lambdas
locals {
  lambdas = {
    "SubmitVote"     = "../aoa-voting-stack/dist/submit-vote/index.js"
    "Status"         = "../aoa-voting-stack/dist/status/index.js"
    "Results"        = "../aoa-voting-stack/dist/results/index.js"
    "AuditReport"    = "../aoa-voting-stack/dist/generate-audit-report/index.js"
    "PreSignup"      = "../aoa-voting-stack/dist/pre-signup-checker/index.js"
    "ToggleWindow"   = "../aoa-voting-stack/dist/toggle-window/index.js"
  }
}

data "archive_file" "lambda_zip" {
  for_each    = local.lambdas
  type        = "zip"
  source_file = each.value
  output_path = "${path.module}/zips/${each.key}.zip"
}

resource "aws_lambda_function" "fn" {
  for_each      = local.lambdas
  function_name = "${var.stack_name}-${each.key}"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = data.archive_file.lambda_zip[each.key].output_path
  source_code_hash = data.archive_file.lambda_zip[each.key].output_base64sha256
  timeout       = 30
  
  environment {
    variables = {
      AWS_REGION = var.region
    }
  }
}

# Permissions for API Gateway and Cognito
resource "aws_lambda_permission" "api_gw" {
  for_each      = toset(["SubmitVote", "Status", "Results"])
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "cognito" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn["PreSignup"].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.pool.arn
}
