variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-1"
}

variable "stack_name" {
  description = "Name of the stack"
  type        = string
  default     = "AoaVotingStack"
}

variable "account_id" {
  description = "AWS Account ID"
  type        = string
}

variable "comelec_phone_number" {
  description = "Phone number for COMELEC alerts (E.164 format)"
  type        = string
}
