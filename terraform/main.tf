provider "aws" {
  profile = "aoa-dev"
  region  = "ap-southeast-1"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

terraform {
  required_version = ">= 1.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.0"
    }
  }
}
