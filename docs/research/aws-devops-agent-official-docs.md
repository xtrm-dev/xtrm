---
created: 2026-06-07T02:22
updated: 2026-06-09T01:35
---
# AWS DevOps Agent — official docs evidence

Date: 2026-05-31

## Summary

AWS docs frame **AWS DevOps Agent** as a **frontier agent** and **always-available operations teammate** that resolves and proactively prevents incidents, optimizes reliability/performance, and handles on-demand SRE tasks across **AWS, multicloud, and on-prem** environments. Core operating model: **Agent Spaces** as isolation boundary, **Operator Web App** for operators, **AWS Management Console** for admins, **skills** + **agent instructions** for memory/policy, and **EventBridge/API/webhooks/MCP/ACP** for automation. [docs + launch pages]


## Delta vs second-mind transcript notes

The earlier video/transcript notes correctly captured the strategic shape — a DevOps agent that combines telemetry, topology, code/deploy context, incident response, and learned operating knowledge. The official docs make several boundaries sharper:

- **Agent Space is the hard tenancy/isolation unit.** The videos made the agent feel like one global operations teammate; the docs make Agent Space the data, permission, history, recommendation, and region boundary.
- **Instructions, Skills, and Learned Skills are separate control surfaces.** The transcript language around “learning” maps to three documented layers: always-loaded `AGENTS.md`, on-demand `SKILL.md` bundles, and auto-generated Learned Skills.
- **Automation surface is broader than chat.** The official docs explicitly name web app, MCP, ACP, webhooks, direct API, and EventBridge events.
- **Recommendations are implementation handoff objects.** The API exposes recommendation status and optional `spec` content, which is more concrete than the video-level “suggests improvements” framing.

This means xtrm should copy the **contract shape** — isolation boundary, standing instructions, task skills, learned topology/tool-use artifacts, journals, recommendations — rather than copy AWS UI language or assume an opaque “agent memory” abstraction.

## Citation precision note

The memo keeps most citations at section level to stay readable, but the bibliography lists the exact AWS pages used. High-confidence claims are those that are repeated across both the user guide/API reference and AWS launch pages: Agent Spaces, Agent Instructions, Skills/Learned Skills, EventBridge lifecycle events, recommendations, journal records, and MCP/ACP/API/webhook access paths. Claims from videos are intentionally treated as context only.

## Official source classes checked

- **Official AWS docs**: user guide + API reference.
- **AWS-owned launch pages**: product page, launch blog, What's New.
- **Second-mind transcript context only**: local transcript analyses named in parent docs; not used as authority.
- **Third-party interpretation**: none used for core claims.

## Exact AWS terminology and product boundaries

### Product framing
- “**frontier agent**” and “**always-available operations teammate**” (product page, GA blog, What's New).
- “**resolves and proactively prevents incidents**”, “**optimizes application reliability and performance**”, “**on-demand SRE tasks**” (product page, GA blog, What’s New).
- “**investigates incidents as an experienced DevOps engineer would**” by learning apps/relationships and correlating telemetry, code, and deployment data (about page, GA blog, product page).

### Boundary object: Agent Space
- **Agent Space** = logical container / independent deployment / access boundary.
- Each space has its own AWS account access, third-party integrations, user permissions, data, incident history, recommendations, and chat history.
- Region where space is created decides where its data lives.
- Cross-region monitoring still works for associated AWS accounts.
- Multiple spaces recommended for team separation, env isolation, service boundaries, compliance.

Sources: `about-aws-devops-agent-what-are-devops-agent-spaces.md`, `about-aws-devops-agent-supported-regions.md`, `about-aws-devops-agent.html`.

### UI / control plane split
- **AWS Management Console**: admin setup, integrations, access control.
- **DevOps Agent web app / Operator Web App**: day-to-day incidents, topology, improvements, chat, skills, instructions.

Source: `about-aws-devops-agent-what-is-a-devops-agent-web-app.md`, `about-aws-devops-agent.html`.

### Memory / policy split
- **Agent instructions**: always-on guidance, stored as **AGENTS.md**, injected every session.
- **Skills**: on-demand modular instruction sets; SKILL.md required; may include refs/assets; loaded when relevant.
- **Learned Skills**: generated from Agent Space data; active by default.

Sources: `about-aws-devops-agent-agent-instructions.md`, `about-aws-devops-agent-devops-agent-skills.md`, `about-aws-devops-agent-learned-skills.md`.

## Capability / workflow map

| Area | AWS terms | What AWS docs say | Evidence |
|---|---|---|---|
| Intake | Chat, webhooks, APIs, MCP, ACP | Five access methods: web app, MCP, ACP, webhooks, direct API | `working-with-devops-agent-interfacing-with-the-devops-agent.md` |
| On-demand ops | On Demand DevOps Tasks / Chat | Query resources, health, deployment history, incident patterns; create charts/reports; attach files; steer investigations | `working-with-devops-agent-on-demand-devops-tasks.md` |
| Incident start | Manual, ServiceNow, PagerDuty, Grafana alarms, webhook | Investigations can start from tickets, webhooks, or manual launch | `working-with-devops-agent-autonomous-incident-response.md` |
| Triage | Linked / Skipped / Proceed | Triage correlates incidents within a look-back window; may link, skip, or start a new investigation | same as above + EventBridge detail ref |
| Investigation | Topology, telemetry, code, deployments, logs, traces | Agent builds investigation log with findings, metrics/logs/traces, code changes, deployment history, remediation attempts, timeline | `working-with-devops-agent-autonomous-incident-response.md` |
| Mitigation | Mitigation plan | Agent offers mitigation plans; EventBridge emits mitigation lifecycle events | `working-with-devops-agent-autonomous-incident-response.md`, EventBridge ref |
| Prevention | Improvements / Recommendations | Weekly by default; manual evaluation supported; categories: observability, infrastructure, governance, code optimization | `working-with-devops-agent-proactive-incident-prevention.md` |
| Support escalation | AWS Support case | Can create support cases with investigation context; plan-dependent | `working-with-devops-agent-autonomous-incident-response.md` |
| Outputs | artifacts, journal records, recommendations, events, charts/reports | Chat artifacts, summary records, recommendation spec, EventBridge events, CloudWatch metrics | API ref + user guide |

## Integrations AWS docs actually name

### Built-in telemetry / observability
- **CloudWatch** (1-way, no extra setup)
- **Dynatrace** (2-way built-in)
- **Datadog**
- **Grafana**
- **New Relic**
- **Splunk**
- **Amazon S3** as readable telemetry/artifact source

### Built-in CI/CD / code
- **GitHub** / **GitHub Actions** / repositories
- **GitLab** / workflows / repositories
- **Azure DevOps** and Azure resources are mentioned in GA launch material

### Ticketing / chat / ops
- **ServiceNow**
- **PagerDuty**
- **Slack**
- **AWS Support**

### Custom / private / extensibility
- **MCP servers**
- **Custom tools** via MCP
- **Private connections** for internal endpoints in VPC
- **ACP** programmatic clients

Sources: `configuring-capabilities-connecting-telemetry-sources-index.md`, `configuring-capabilities-for-aws-devops-agent-connecting-to-cicd-pipelines-index.md`, `configuring-capabilities-for-aws-devops-agent-connecting-to-ticketing-and-chat-index.md`, `configuring-capabilities-for-aws-devops-agent-connecting-to-privately-hosted-tools.md`, product page, GA blog.

## Learned-skills / operational-memory model

### What AWS documents
- **Agent instructions**: always loaded, no skill matching, AGENTS.md, max 25 KB, recommended 120 lines.
- **Skills**: modular, on-demand, non-executable docs only; support Markdown, PDFs, images, data files; SKILL.md required; frontmatter `name` + `description` decides activation.
- **Learned Skills**:
  - **Agent Space Understanding**: auto-generated from connected accounts, repos, telemetry; builds topology, request paths, repo-to-resource mapping, observability coverage.
  - **Tool Use Best Practices**: auto-generated from prior investigations; updated every 30 investigations.
  - Both active by default; can be deactivated; Topology page uses Agent Space Understanding; regeneration via Topology page or chat.

### Meaning
AWS does not describe “memory” as a generic vector store. Docs describe a **documented control system**:
1. standing policy in AGENTS.md,
2. task-specific skills in SKILL.md bundles,
3. learned skills synthesized from environment and usage,
4. execution journals / summaries for each task.

Sources: agent instructions, skills, learned skills, API `JournalRecord`.


## AWS concept → xtrm/Mercury mapping

| AWS concept | xtrm/Mercury analogue | Owner | Implementation implication |
|---|---|---|---|
| Agent Space | repo/team/env operational boundary | infra + specialists | Do not collapse all Mercury services into one context; use explicit scope per investigation. |
| Agent Instructions / `AGENTS.md` | standing policy, safety rules, repo/service runbooks | specialists + service repos | Keep always-on policy separate from task playbooks. |
| Skills / `SKILL.md` | specialist skills and service skills | specialists / xtrm | Use description-triggered, modular playbooks for incident classes and deploy tasks. |
| Learned Skills | generated topology/tool-use/incident lessons | specialists + second-mind memories | Build durable topology and tool-use artifacts from completed runs instead of relying only on transient chat. |
| Journal records / summaries | specialist timeline, result, bead notes, xt reports | specialists + beads | Every incident/deploy task should leave replayable evidence. |
| Recommendations with `spec` | bd implementation beads / OpenSpec task specs | gitboard + beads | Recommendation output should become backlog-ready work, not a freeform paragraph. |
| EventBridge lifecycle events | xtrm event bus / gitboard realtime events | gitboard + specialists | Emit lifecycle events for investigations, mitigations, recommendations, and approvals. |

## Incident / ops loop

1. **Detect / ingest**: alert, ticket, webhook, or manual start.
2. **Triage**: correlate duplicate/related incidents; **Linked / Skipped / Proceed**.
3. **Investigate**: topology + telemetry + code + deployment history + logs/traces.
4. **Mitigate**: generate mitigation plan; track mitigation lifecycle.
5. **Summarize**: produce journal records and summary records.
6. **Escalate**: create AWS Support case with context.
7. **Prevent**: weekly/manual evaluation produces ranked recommendations.
8. **Close loop**: EventBridge emits lifecycle events; external automation can react.

EventBridge source is always `aws.aidevops`.

Sources: autonomous incident response, proactive prevention, EventBridge detail reference.

## Supported environments

- **AWS** across associated accounts in any supported Region.
- **Multicloud** and **hybrid / on-prem** per product page and GA launch blog.
- **Azure** and **Azure DevOps** called out in GA launch blog.
- **Private/internal systems** via private connections + VPC Lattice.
- Data residency bound to Agent Space Region; cross-region resource monitoring still works.
- Supported Regions at docs time: `us-east-1`, `us-west-2`, `ap-southeast-2`, `ap-northeast-1`, `eu-central-1`, `eu-west-1`.

Sources: product page, GA blog, supported regions, private connections.

## Inputs / outputs

### Inputs
- Chat prompts, page context, file attachments.
- Incident tickets, alarms, webhooks.
- API calls: `CreateAgentSpace`, `CreateChat`, `ListRecommendations`, `ListJournalRecords`, `GetRecommendation`.
- MCP / ACP clients.
- Telemetry + repo + deployment data from integrations.

### Outputs
- `executionId` from `CreateChat`.
- `taskId`, task statuses, and EventBridge lifecycle events.
- Journal records and summary records (`summary_record_id`).
- Recommendation objects with `summary` + optional `spec` (agent-ready implementation steps).
- Chat artifacts, reports, charts.
- AWS Support case context.
- CloudWatch usage metrics and alarms.

### API shapes AWS exposes
- `CreateAgentSpace` input: name, description, KMS key ARN, locale, tags.
- `CreateChat` input: `agentSpaceId`, `userType`; `userId` deprecated.
- `Task` statuses: `PENDING_TRIAGE`, `LINKED`, `PENDING_START`, `IN_PROGRESS`, `PENDING_CUSTOMER_APPROVAL`, `COMPLETED`, `FAILED`, `TIMED_OUT`, `CANCELED`.
- `Recommendation` statuses: `PROPOSED`, `ACCEPTED`, `REJECTED`, `CLOSED`, `COMPLETED`, `UPDATE_IN_PROGRESS`.

Sources: API reference pages.

## Gaps / unknowns in AWS docs

- No public doc here explains the exact internal prompt chain or model routing.
- No public doc here describes how learned-skill ranking is implemented beyond “description matching” and environment-driven synthesis.
- No public doc here gives full size/shape limits for all chat artifacts or all journal content beyond API schemas.
- Public docs do not fully spell out mutation boundaries for every integration; safest documented posture is read-first + human approval where needed.
- Docs I checked do not publish a complete quota matrix for investigations, recommendations, or chats in one place.
- Preview-vs-GA deltas may still exist across pages; docs and blog should be read as current over older video transcripts.

## Implications for `infra-bnh`, `unitAI-eoqxp`, `forge-ow7c`

### Shared rule
Use **one Agent Space per operational boundary**: repo/team/env. Don’t collapse all three into one space.

### `infra-bnh`
- Match AWS model most closely: ops-first, telemetry-first, read-first.
- Put Grafana/Prometheus/CloudWatch behind agent-accessible tools.
- Use EventBridge/webhooks for post-deploy and incident triggers.
- Keep private tools behind private connections; no public Internet path.
- Encode standing policy in Agent Instructions; scenario playbooks in Skills.

### `unitAI-eoqxp`
- If this repo owns agent/runtime behavior, split **agent policy** from **task playbooks** the same way AWS does.
- Use learned-skill style artifacts for environment topology and tool-use patterns.
- Treat deployment history + code + telemetry as one investigation graph, not separate silos.

### `forge-ow7c`
- Treat gitboard as the **operator console**, not the deploy engine: it should render investigations, recommendations, journals, evidence links, approvals, and follow-up beads.
- Use AWS-style recommendation `spec` handoff as the UX model for turning observations into backlog-ready work.
- Surface destructive-action approvals and audit trails, but keep execution authority in specialists/infra-owned tools.
- Mirror EventBridge-style lifecycle events in the xtrm event bus so the console can show investigation/mitigation/recommendation state without polling raw systems.

## Bibliography

### Official AWS docs
- https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.html (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent-what-are-devops-agent-spaces.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent-what-is-a-devops-agent-web-app.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent-agent-instructions.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent-devops-agent-skills.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent-learned-skills.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/working-with-devops-agent.html (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/working-with-devops-agent-on-demand-devops-tasks.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/working-with-devops-agent-autonomous-incident-response.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/working-with-devops-agent-proactive-incident-prevention.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/working-with-devops-agent-interfacing-with-the-devops-agent.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent-supported-regions.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent-what-is-a-devops-agent-topology.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-capabilities-for-aws-devops-agent-connecting-telemetry-sources-index.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-capabilities-for-aws-devops-agent-connecting-to-cicd-pipelines-index.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-capabilities-for-aws-devops-agent-connecting-to-ticketing-and-chat-index.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-capabilities-for-aws-devops-agent-connecting-to-privately-hosted-tools.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-capabilities-for-aws-devops-agent-integrating-devops-agent-into-event-driven-applications-using-amazon-eventbridge-index.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/userguide/integrating-devops-agent-into-event-driven-applications-using-amazon-eventbridge-devops-agent-events-detail-reference.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_Operations.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_CreateAgentSpace.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_CreateChat.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_Task.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_Recommendation.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_RecommendationContent.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_GetRecommendation.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_ListRecommendations.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_JournalRecord.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_ListJournalRecords.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_SendMessageSummaryEvent.md (accessed 2026-05-31)
- https://docs.aws.amazon.com/devopsagent/latest/APIReference/API_SendMessageResponseCreatedEvent.md (accessed 2026-05-31)

### AWS-owned launch pages
- https://aws.amazon.com/devops-agent/ (accessed 2026-05-31)
- https://aws.amazon.com/blogs/mt/announcing-general-availability-of-aws-devops-agent/ (accessed 2026-05-31)
- https://aws.amazon.com/about-aws/whats-new/2026/03/aws-devops-agent-generally-available/ (accessed 2026-05-31)
- https://aws.amazon.com/about-aws/whats-new/2025/12/devops-agent-preview-frontier-agent-operational-excellence/ (accessed 2026-05-31)

### Second-mind transcript context only
- `inbox/transcripts/Introducing-AWS-DevOps-Agent-Amazon-Web-Services.analysis.md`
- `inbox/transcripts/AWS-reInvent-2025-Move-beyond-reactive-Transform-cloud-ops-with-AWS-DevOps-Agent-COP362.analysis.md`
- `inbox/transcripts/Diving-Deep-on-AWS-DevOps-Agent-AWS-Tech-Tales.analysis.md`

## Confidence

High. Official AWS docs were current and internally consistent across user guide, API reference, product page, and GA blog.
