terraform {
  required_version = ">= 1.17.1, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.72.0"
    }
  }
}

variable "endpoint" {
  type    = string
  default = "http://127.0.0.1:4566"
  validation {
    condition     = can(regex("^http://(127[.]0[.]0[.]1|localhost|floci):[0-9]{1,5}$", var.endpoint))
    error_message = "Use an explicit local Floci HTTP endpoint."
  }
}

variable "prefix" {
  type    = string
  default = "multi-agent-tf"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,39}$", var.prefix))
    error_message = "Use 3–40 lowercase letters, digits, or hyphens, beginning with a letter."
  }
}

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  s3_use_path_style           = true

  endpoints {
    dynamodb = var.endpoint
    iam      = var.endpoint
    s3       = var.endpoint
    sqs      = var.endpoint
    sts      = var.endpoint
  }
}

resource "aws_sqs_queue" "ingestion_dlq" {
  name = "${var.prefix}-ingestion-dlq"
}

resource "aws_sqs_queue" "ingestion" {
  name = "${var.prefix}-ingestion"
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingestion_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "consolidation" {
  name = "${var.prefix}-consolidation"
}

resource "aws_dynamodb_table" "platform" {
  for_each     = toset(["results", "consolidations"])
  name         = "${var.prefix}-${each.key}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  dynamic "attribute" {
    for_each = toset(["pk", "sk", "indexPk", "indexSk"])
    content {
      name = attribute.value
      type = "S"
    }
  }

  global_secondary_index {
    name            = "lookup"
    projection_type = "ALL"
    key_schema {
      attribute_name = "indexPk"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "indexSk"
      key_type       = "RANGE"
    }
  }
}

resource "aws_s3_bucket" "artifacts" {
  bucket = "${var.prefix}-artifacts"
}

output "resource_prefix" {
  value = var.prefix
}
