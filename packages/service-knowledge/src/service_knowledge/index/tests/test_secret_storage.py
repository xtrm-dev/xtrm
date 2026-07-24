"""Secret persistence regression across vaultctl and service-knowledge projections."""
from __future__ import annotations

from service_knowledge import index
from service_knowledge.index import schema


def test_secret_values_absent_from_all_searchable_layers(alertmanager_consumer):
    secrets = (
        "AKIAIOSFODNN7EXAMPLE",
        "ghp_1234567890abcdefghijklmnopqrstuv",
        "redis://:supersecretpw@redis.example.test:6379/0",
        "https://discord.com/api/webhooks/123456789/discord-secret-token",
        "https://hooks.example.test/generic-secret-token",
    )
    skill = (
        alertmanager_consumer
        / ".xtrm/skills/infra/service-knowledge/services/alertmanager/SKILL.md"
    )
    skill.write_text(
        skill.read_text(encoding="utf-8")
        + "\n## Credentials\n"
        + "aws_access_key_id = AKIAIOSFODNN7EXAMPLE\n"
        + "token: ghp_1234567890abcdefghijklmnopqrstuv\n"
        + "cache: redis://:supersecretpw@redis.example.test:6379/0\n"
        + 'DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/123456789/discord-secret-token"\n'
        + "ALERT_WEBHOOK_URL: https://hooks.example.test/generic-secret-token\n",
        encoding="utf-8",
    )

    index.build(alertmanager_consumer)
    conn = schema.connect(alertmanager_consumer)
    try:
        layers = {
            "documents": conn.execute("SELECT * FROM documents").fetchall(),
            "sections": conn.execute("SELECT * FROM sections").fetchall(),
            "sections_fts": conn.execute("SELECT * FROM sections_fts").fetchall(),
            "sk_items": conn.execute("SELECT * FROM sk_items").fetchall(),
            "sk_items_fts": conn.execute("SELECT * FROM sk_items_fts").fetchall(),
        }
    finally:
        conn.close()

    for rows in layers.values():
        stored = "\n".join("\x1f".join(str(value) for value in row) for row in rows)
        for secret in secrets:
            assert secret not in stored

    for secret in secrets:
        result = index.search(alertmanager_consumer, secret)
        assert all(secret not in str(row) for row in result["results"])

    skill = index.get_full_skill(
        alertmanager_consumer,
        ".xtrm/skills/infra/service-knowledge/services/alertmanager/SKILL.md",
    )
    assert skill is not None
    assert all(secret not in skill["body"] for secret in secrets)
