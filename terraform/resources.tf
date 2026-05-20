# S3 Buckets
resource "aws_s3_bucket" "audit_archive" {
  bucket              = "audit-archive-bucket-${var.account_id}-${var.environment}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit_archive.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AWSCloudTrailAclCheck"
      Effect = "Allow"
      Principal = { Service = "cloudtrail.amazonaws.com" }
      Action   = "s3:GetBucketAcl"
      Resource = aws_s3_bucket.audit_archive.arn
    }, {
      Sid    = "AWSCloudTrailWrite"
      Effect = "Allow"
      Principal = { Service = "cloudtrail.amazonaws.com" }
      Action   = "s3:PutObject"
      Resource = "${aws_s3_bucket.audit_archive.arn}/AWSLogs/${var.account_id}/*"
      Condition = {
        StringEquals = { "s3:x-amz-acl" = "bucket-owner-full-control" }
      }
    }]
  })
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit_archive.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit_archive.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 365
    }
  }
  depends_on = [aws_s3_bucket_versioning.audit]
}

resource "aws_s3_bucket" "participant_list" {
  bucket = "participant-list-bucket-${var.account_id}-${var.environment}"
}

resource "aws_s3_bucket_versioning" "participants" {
  bucket = aws_s3_bucket.participant_list.id
  versioning_configuration { status = "Enabled" }
}

# Frontend Bucket
resource "aws_s3_bucket" "frontend" {
  bucket = "frontend-bucket-${var.account_id}-${var.environment}"
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  index_document { suffix = "index.html" }
  error_document { key = "index.html" }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicRead"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
    }]
  })
}

# DynamoDB
resource "aws_dynamodb_table" "has_voted" {
  name           = "HasVotedTable-${var.account_id}-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "voterId"
  point_in_time_recovery { enabled = true }
  attribute {
    name = "voterId"
    type = "S"
  }
}

resource "aws_dynamodb_table" "results" {
  name           = "ResultsTable-${var.account_id}-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "proposalId"
  range_key      = "voteId"
  point_in_time_recovery { enabled = true }
  attribute {
    name = "proposalId"
    type = "S"
  }
  attribute {
    name = "voteId"
    type = "S"
  }
}

# SSM & Secret
resource "aws_ssm_parameter" "window_open" {
  name      = "/voting/window-open"
  type      = "String"
  value     = var.window_default
  overwrite = true
}

resource "aws_secretsmanager_secret" "hmac_key" {
  name = "hmac-signing-key-${var.account_id}-${var.environment}"
}

resource "aws_secretsmanager_secret_version" "hmac_key" {
  secret_id     = aws_secretsmanager_secret.hmac_key.id
  secret_string = var.hmac_secret_val
}

# Cognito
resource "aws_cognito_user_pool" "pool" {
  name = "${var.cognito_pool}-${var.environment}"
  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
  }
  # Lambda triggers removed as requested
}

resource "aws_cognito_user_pool_client" "client" {
  name                = "AoaUserPoolClient"
  user_pool_id        = aws_cognito_user_pool.pool.id
  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
}

# EC2 Networking
data "http" "myip" {
  url = "http://ipv4.icanhazip.com"
}

resource "aws_security_group" "aoa_sg" {
  name        = "aoa-sg"
  description = "AOA EC2 Security Group"

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["${chomp(data.http.myip.response_body)}/32"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# EC2 IAM
resource "aws_iam_role" "ec2_role" {
  name = "aoa-ec2-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ec2_policy" {
  name = "aoa-ec2-policy"
  role = aws_iam_role.ec2_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Scan", "dynamodb:Query", "dynamodb:DescribeTable"
        ]
        Effect   = "Allow"
        Resource = [aws_dynamodb_table.has_voted.arn, aws_dynamodb_table.results.arn]
      },
      {
        Action = ["ssm:GetParameter", "ssm:GetParameters"]
        Effect   = "Allow"
        Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/voting/*"
      },
      {
        Action = ["secretsmanager:GetSecretValue"]
        Effect   = "Allow"
        Resource = aws_secretsmanager_secret.hmac_key.arn
      },
      {
        Action = ["s3:GetObject", "s3:ListBucket"]
        Effect   = "Allow"
        Resource = [aws_s3_bucket.participant_list.arn, "${aws_s3_bucket.participant_list.arn}/*"]
      },
      {
        Action = ["s3:PutObject"]
        Effect   = "Allow"
        Resource = ["${aws_s3_bucket.audit_archive.arn}/*"]
      },
      {
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "aoa-ec2-profile"
  role = aws_iam_role.ec2_role.name
}

# EC2 Instance
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023*-x86_64"]
  }
}

resource "aws_instance" "server" {
  ami                  = data.aws_ami.amazon_linux_2023.id
  instance_type        = "t3.micro"
  key_name             = var.key_pair_name
  iam_instance_profile = aws_iam_instance_profile.ec2_profile.name
  vpc_security_group_ids = [aws_security_group.aoa_sg.id]

  user_data = <<-EOF
              #!/bin/bash
              sudo yum update -y
              sudo yum install -y git nginx
              
              # Install Node 18
              curl -sL https://rpm.nodesource.com/setup_18.x | sudo bash -
              sudo yum install -y nodejs
              
              # Install PM2
              sudo npm install -g pm2
              
              # Start Nginx
              sudo systemctl start nginx
              sudo systemctl enable nginx
              
              # Setup App (placeholder - user will likely clone manually or I should provide more)
              # cd /home/ec2-user
              # git clone ...
              EOF

  tags = {
    Name = "AoaVotingServer"
  }
}

resource "aws_eip" "server_eip" {
  instance = aws_instance.server.id
}

# Monitoring
resource "aws_cloudwatch_log_group" "trail_logs" {
  name              = "/aws/cloudtrail/AoaAuditTrail-${var.environment}"
  retention_in_days = 365
}

resource "aws_cloudtrail" "audit" {
  name                          = "AoaAuditTrail-${var.environment}"
  s3_bucket_name                = aws_s3_bucket.audit_archive.id
  include_global_service_events = true
  enable_log_file_validation    = true
  is_multi_region_trail         = false
  cloud_watch_logs_role_arn     = aws_iam_role.cloudtrail_role.arn
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.trail_logs.arn}:*"

  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }
}

resource "aws_iam_role" "cloudtrail_role" {
  name = "AoaCloudTrailRole-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "cloudtrail.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "cloudtrail_policy" {
  name = "AoaCloudTrailPolicy-${var.environment}"
  role = aws_iam_role.cloudtrail_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "logs:CreateLogStream"
      Effect = "Allow"
      Resource = "${aws_cloudwatch_log_group.trail_logs.arn}:*"
    }, {
      Action = "logs:PutLogEvents"
      Effect = "Allow"
      Resource = "${aws_cloudwatch_log_group.trail_logs.arn}:*"
    }]
  })
}

resource "aws_sns_topic" "alerts" {
  name = "AoaAlerts-${var.environment}"
}

resource "aws_sns_topic_subscription" "sms" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "sms"
  endpoint  = var.comelec_phone_number
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_budgets_budget" "budget" {
  name              = "AoaMonthlyBudget-${var.environment}"
  budget_type       = "COST"
  limit_amount      = var.budget_limit
  limit_unit        = "USD"
  time_unit         = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
