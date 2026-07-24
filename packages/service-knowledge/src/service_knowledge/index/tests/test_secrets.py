"""Secret scrubbing: planted AWS key + credentialed URL redacted; .env skipped; names kept."""
from __future__ import annotations

from service_knowledge.index import secrets


def test_aws_key_redacted():
    text = "aws_access_key_id = AKIAIOSFODNN7EXAMPLE and more text"
    result = secrets.scrub(text)
    assert "AKIAIOSFODNN7EXAMPLE" not in result.text
    assert secrets.REDACTION in result.text
    assert "aws_access_key_id" in result.kinds or "generic_secret_assignment" in result.kinds


def test_redis_url_password_redacted():
    text = "connect to redis://:hunter2secret@redis.local:6379/0 here"
    result = secrets.scrub(text)
    assert "hunter2secret" not in result.text
    assert "url_credential" in result.kinds


def test_env_var_name_kept_value_redacted():
    text = 'DISCORD_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX"'
    result = secrets.scrub(text)
    assert "DISCORD_WEBHOOK_URL" in result.text  # name indexed
    assert "T000/B000/XXXX" not in result.text   # value gone


def test_env_files_skipped():
    assert secrets.should_skip_file(".env")
    assert secrets.should_skip_file("svc/.env.production")
    assert secrets.should_skip_file("secrets.yaml")
    assert not secrets.should_skip_file("svc/config.yml")
    assert not secrets.should_skip_file("alertmanager/SKILL.md")
