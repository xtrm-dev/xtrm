---
date_created: Friday, May 29th 2026, 6:19:13 pm
date_modified: Monday, June 1st 2026, 5:33:50 pm
title: devops-specialists
---
## links
- [[agentops-telemetry-for-specialists]]
- [[devops-query-surfaces-mcp-architecture]]
- [[sre-telemetry-patterns-for-mercury]]
- [[terraform-first-steps]]
- vps: /home/dawid/dev/specialists/docs/design/substrate/devops-platform-engineering-prd.md
*/operator_notes: il devops agent di aws utilizza subagents per raccogliere dati e farsi aiutare. Significa che dovrebbe essere nel nostro caso uno specialists di "alto livello" di capacità come il dispatch di ulteriori specialist oppure che dobbiamo definire delle identità di specialist più helper e dedicati a raccogliere determinate metriche, più leggeri del principal-devops specialist. Potrebbe essere un node ed esserne il coordinator? il node-coordinator può fare dispatch di chains dedicate, nuovi node quando necessario. oppure teniamo il coordinator con il suo contratto attuale e semplicemente il devops propone escalation, quando necessario, per cui sono entrambi potenti e coordinano insieme la task devops.*

The specialists roster currently is missing a specialized devops agent. AWS Devops agent is been recently released, and it is very powerful. The pipeline that was built for it is amazing, they have a full UI and ux very well scoped, which goes beyond our current terminal only + light ~/dev/gitboard app stack. The idea is first to wire the devops agent to the vps stack, very powerful. Then to decide: wire it with specialists-service container? Create a specific devops-specialist container (with a clone of the repository to investigate) with access to the prometheus metrics (which is quite complete, but definitely has to be expanded telemetry, so a first exploration pass on all the mercury repos would be needed, and the process requires to be standardized) - and another thing: expand our "gitboard" (future xtrm console) with a dedicated devops page that is connected with the infra side, and the devops agent integrated.
This cleanly integrates with the fact that we want to adopt datadog like dashbaoards, prometheus and grafana integrations (via mcp, custom tools).
The devops specialists i think should be also per-repo export in deploying, or perhaps, a new deploying specialist emerges from the research scope.
This is a principle, but then, when substrate lands in the xtrm project group, that can be expanded into a long running node. Right now, we will do a principle/primitive of the pulse emitter to wakeup on events and on scheduled intervals (imagine a collaboration between Dev (developer specialists) and Ops that fire after a new deployment and monitor more heavily to measure pre+post performance, errors on which they pushback).
More that's missing: IoT (terraform like)
To investigate:
- [AWS re:Invent 2025 - Move beyond reactive: Transform cloud ops with AWS DevOps Agent (COP362) - YouTube](https://www.youtube.com/watch?v=JajBEYle67I) (transcriber)
- [Introducing AWS DevOps Agent \| Amazon Web Services - YouTube](https://www.youtube.com/watch?v=fMQfzwS0prQ) (transcriber)
- [About AWS DevOps Agent - AWS DevOps Agent](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.html) (researcher input)
- **researcher with broad scope onto WHAT a devops should be an expert of (see the indicazioni header below**
- [Docker \| Terraform \| HashiCorp Developer](https://developer.hashicorp.com/terraform/tutorials/docker-get-started)
- [Diving Deep on AWS DevOps Agent \| AWS Tech Tales - YouTube](https://www.youtube.com/watch?v=uFgGARWSCWk)
- 
  
**risorse**
[Grafana MCP server \| Grafana documentation](https://grafana.com/docs/grafana/latest/developer-resources/mcp/)
[GitHub - pab1it0/prometheus-mcp-server: A Model Context Protocol (MCP) server that enables AI agents and LLMs to query and analyze Prometheus metrics through standardized interfaces. · GitHub](https://github.com/pab1it0/prometheus-mcp-server)

Diversi contesti per un devops agent:
**nel caso degli specialists/substrate/core stack stesso:
- deploy automatico degli agenti
- provisioning dei server
- monitoraggio CPU, RAM e token usage
- gestione dei worktree e dei job runner
- alerting sui servizi critici
- backup e disaster recovery
- scalabilità della piattaforma
- osservabilità completa di pipeline, MCP e database
- verifica di sp ps, cleanup e monitoring processi orfani, serena lsp, dolt ecc.
**nel caso cloud/vps/aws**:
- costruire pipeline CI/CD
- gestire Kubernetes
- configurare cloud AWS/Azure/GCP
- scrivere Terraform
- automatizzare deployment
- monitorare sistemi
- gestire alert
- ottimizzare affidabilità e costi
- implementare sicurezza nelle pipeline
- supportare gli sviluppatori nella delivery
Per la questione CI/CD: 
La lists sopra "cloud/vps" si parla anche di costruire pipeline CI/CD, quindi questo è separato comunque da fase di monitoring?

Inoltre, siccome il devops agent potrebbe essere risvegliato ad hoc mi immagino anche uno scenario: anzichè far usare docker compose up direttamente, uno specialist devops configurato correttamente per-repo, potrebbe essere invocato eseguendo ad esempio make spdeploy (e gli agenti dev devono essere istruiti a farlo, e sicuramente un hook ed extension che vieta l'utilizzo di comandi docker diretti).

Un'altra cosa, vagamente separata, è che manca un database specialist, un plausibile mcp server creato ad hoc per i miei databases.
## indicazioni

# DevOps / Platform Engineering Responsibilities for Mercury

## Mission

The primary responsibility of DevOps within Mercury is not feature development, but enabling developers to build, test, deploy, operate, and scale the platform safely, efficiently, and repeatably.
DevOps owns the platform layer that sits between software engineering and infrastructure. The goal is to maximize developer velocity while maintaining reliability, observability, security, and operational control.
---

## Continuous Integration & Continuous Delivery (CI/CD)

Mercury deployments should be fully automated.
Every code change should trigger a standardized pipeline capable of:
- Building Docker images
- Running automated tests
- Performing security and dependency scans
- Publishing versioned artifacts
- Deploying to staging environments
- Executing health checks
- Promoting validated releases to production
The desired workflow is:
```text
Git Push
    ↓
Automated Validation
    ↓
Docker Build
    ↓
Security Scanning
    ↓
Artifact Publishing
    ↓
Deployment
    ↓
Health Verification
```
Manual deployments should be the exception rather than the norm.
---

## Platform & Container Infrastructure

Mercury consists of a large collection of independently deployable services, including:
- Agent runtimes
- Specialist services
- MCP servers
- Dolt infrastructure
- Shared LSP services
- Schedulers
- APIs
- Background workers
DevOps is responsible for the operational platform supporting these services, including:
- Container orchestration
- Service discovery
- Secrets management
- Network configuration
- Resource allocation
- Restart policies
- Environment management
- Scalability controls
Whether implemented using Docker Compose, Docker Swarm, Nomad, or Kubernetes, the objective remains identical: predictable and resilient service operation.
---

## Observability

Observability is a first-class concern for Mercury.
The platform should provide real-time visibility into:
- System health
- Agent execution
- Queue depth
- Resource consumption
- Token utilization
- Failure rates
- Latency
- Infrastructure state
Metrics should be collected centrally through systems such as Prometheus and visualized through Grafana.
Examples include:
- Active specialists
- Running jobs
- Waiting jobs
- LSP instance counts
- Dolt server counts
- Token consumption
- Memory usage
- CPU utilization
- API latency
- Queue growth
Every critical operational metric should be measurable.
---

## Alerting

Metrics without actionability provide limited value.
The platform should automatically detect abnormal states such as:
- Duplicate infrastructure processes
- Excessive queue growth
- Resource exhaustion
- Service failures
- Token budget overruns
- Database unavailability
- MCP connectivity failures
Alerts should be routed to operators before failures impact users.
Examples:
```text
dolt_servers > expected_count
queue_depth > threshold
memory_usage > threshold
token_consumption > budget
specialist_failure_rate > threshold
```
---

## Reliability Engineering

Mercury should be designed around graceful failure.
DevOps is responsible for implementing:
- Automatic restarts
- Health checks
- Retry mechanisms
- Failure isolation
- Backup systems
- Recovery procedures
- Disaster recovery plans
The objective is to ensure that individual component failures do not cascade into platform-wide outages.
---

## Capacity Planning

Agent platforms introduce unique scaling challenges.
DevOps should continuously answer questions such as:
- How many specialists can run concurrently?
- How many LSP instances can be sustained?
- What are the memory requirements under peak load?
- Which services are bottlenecks?
- What is the marginal cost of additional workload?
- Where are throughput limitations occurring?
Capacity planning transforms infrastructure decisions from guesswork into measurable engineering decisions.
---

## Cost Management

LLM infrastructure introduces operational costs beyond traditional compute.
Mercury should track:
- Token consumption
- Model usage
- Compute utilization
- Storage growth
- Network traffic
- Service-level operational costs
The platform should make it possible to determine:
- Which agents are most expensive
- Which workflows generate the highest cost
- Cost per job
- Cost per user
- Cost per workflow category
Operational visibility should include financial visibility.
---

## Developer Experience (DX)

One of the highest leverage DevOps responsibilities is reducing developer friction.
Developers should not need deep operational knowledge to work effectively.
The platform should expose simple workflows such as:
```text
mercury new-specialist
mercury test
mercury deploy
mercury logs
mercury debug
```
Complex infrastructure concerns should be abstracted behind stable platform interfaces.
The best platform is one that developers barely need to think about.
---

## Security

Security should be embedded directly into the platform lifecycle.
Responsibilities include:
- Secret management
- Credential rotation
- Dependency scanning
- Container image scanning
- Access control
- Audit logging
- Supply-chain security validation
Security controls should be automated wherever possible.
---

## Summary

For Mercury, DevOps evolves beyond traditional infrastructure management and becomes Platform Engineering.
The core objective is not simply deploying 50+ services.
The real objective is providing immediate answers to questions such as:
- Why is a workflow delayed?
- Which agent is consuming excessive tokens?
- Why are additional LSP instances being created?
- Which component is failing?
- What is the current operational cost?
- Where is the platform bottleneck?
A successful Mercury platform allows developers to focus on building agents and features while the underlying system provides deployment automation, observability, reliability, scalability, security, and operational insight by default.