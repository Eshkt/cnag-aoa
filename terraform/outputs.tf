output "ec2_public_ip" {
  value = aws_eip.server_eip.public_ip
}

output "ec2_public_dns" {
  value = aws_eip.server_eip.public_dns
}

output "user_pool_id" {
  value = aws_cognito_user_pool.pool.id
}

output "app_client_id" {
  value = aws_cognito_user_pool_client.client.id
}

output "has_voted_table" {
  value = aws_dynamodb_table.has_voted.name
}

output "results_table" {
  value = aws_dynamodb_table.results.name
}

output "participant_bucket" {
  value = aws_s3_bucket.participant_list.id
}

output "audit_bucket" {
  value = aws_s3_bucket.audit_archive.id
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.id
}
