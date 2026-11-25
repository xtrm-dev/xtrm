# Replay fixtures (XTRM-1043)

Redacted windows of real transcripts for `test/replay.test.ts`. Each record keeps its kind, order,
timestamps, ids, roles, stop reasons, tool names and call ids, flags, Pi custom types, Claude command
names and the opening tag of injected text. Every prompt, reply, thought, tool input and output, path and
summary is a placeholder. Attribute values (peer names, message ids) are short hashes, so equal values
stay equal. `_src` is the record's line in the source transcript.

| fixture | source | lines | what it covers |
|---|---|---|---|
| `claude-adapter-a09891e1.jsonl` | Claude, XTRM-1020 adapter session `a09891e1` | 1–260 | skill commands at session start are prompts |
| `claude-working-design-a9a8fd4e-599.jsonl` | Claude, working-design session `a9a8fd4e` | 560–660 | auto compaction after a settled turn |
| `claude-working-design-a9a8fd4e-2620.jsonl` | same | 2580–2680 | second auto compaction |
| `claude-oblw-2f0aa11a-6365.jsonl` | Claude, oblw session `2f0aa11a` | 6330–6420 | manual `/compact`: typed record, compaction, caveat, command, output |
| `claude-thread-lead-8a1d4345-2117.jsonl` | Claude, thread-lead session `8a1d4345` | 1995–2180 | task notification, peer messages, idle `/compact`, `/model` |
| `claude-thread-lead-8a1d4345-2803.jsonl` | same | 2780–2850 | `AskUserQuestion` attention |
| `pi-i1wb-01a20df7-798.jsonl` | Pi, i1wb session `01a20df7` (header + window) | 780–840 | task, specialist and intercom notices wake the agent |
| `pi-i1wb-01a20df7-1236.jsonl` | same | 1225–1345 | abort, task notification, 502/503 retries |

Regenerate one window:

```bash
node scripts/redact-transcript.mjs <pi|claude> <source.jsonl> <from> <to> test/fixtures/replay/<name>.jsonl
```

Replay any transcript (fixture or real) and print its status transitions:

```bash
node scripts/replay-transcript.ts <pi|claude> <transcript.jsonl> [scratch-dir] [fresh-every]
```
