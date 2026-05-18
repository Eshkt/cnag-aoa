output "api_url" {
  value = "${aws_api_gateway_stage.prod.invoke_url}/"
}

output "user_pool_id" {
  value = aws_cognito_user_pool.pool.id
}

output "user_pool_client_id" {
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
