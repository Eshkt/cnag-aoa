variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-1"
}

variable "aws_profile" {
  description = "AWS CLI profile name"
  type        = string
  default     = "aoa-dev"
}

variable "environment" {
  description = "Deployment environment (dev/prod)"
  type        = string
}

variable "stack_name" {
  description = "Name of the stack"
  type        = string
}

variable "cognito_pool" {
  description = "Name of the Cognito User Pool"
  type        = string
}

variable "api_name" {
  description = "Name of the API Gateway"
  type        = string
}

variable "voter_emails" {
  description = "Initial list of authorized voter emails"
  type        = list(string)
}

variable "hmac_secret_val" {
  description = "Initial value for HMAC secret"
  type        = string
  sensitive   = true
}

variable "window_default" {
  description = "Default state of the voting window"
  type        = string
  default     = "false"
}

variable "budget_limit" {
  description = "Monthly budget limit in USD"
  type        = string
}

variable "alert_email" {
  description = "Email for budget and system alerts"
  type        = string
}

variable "account_id" {
  description = "AWS Account ID"
  type        = string
}

variable "comelec_phone_number" {
  description = "Phone number for COMELEC alerts (E.164 format)"
  type        = string
}

variable "key_pair_name" {
  description = "Name of the SSH key pair for EC2"
  type        = string
}
