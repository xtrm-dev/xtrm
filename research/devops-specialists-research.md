---
title: ricerca-specialista-devops
aliases:
  - DevOps specialist research synthesis
  - Ricerca DevOps specialist
  - DevOps specialist per xtrm e Mercury
date_created: 2026-05-30
date_modified: 2026-05-30
---

# Ricerca sullo specialista DevOps per xtrm e Mercury

## Sintesi esecutiva

La ricerca sulle fonti non-YouTube, letta insieme alle tre analisi già prodotte sui video di AWS DevOps Agent, porta a una conclusione abbastanza netta: un vero DevOps agent non dovrebbe essere pensato come “un altro agente che sa lanciare comandi Docker”. La forma più potente è diversa. È uno strato operativo che unisce topologia dei servizi, telemetria, cronologia dei deployment, repository, runbook, stato dei job, costo dei modelli, allarmi e capacità di spiegare cosa sta succedendo prima di toccare la produzione.

AWS DevOps Agent è utile soprattutto come modello mentale. Il suo valore non è soltanto che usa un LLM, ma che inserisce il LLM dentro una cornice operativa: **Agent Spaces** per delimitare il raggio d’azione, integrazioni con sistemi di osservabilità, integrazioni con repository e CI/CD, flussi di investigazione incidenti, prevenzione proattiva e interfaccia web costruita per operatori. La lezione per xtrm/Mercury è che lo specialista DevOps deve nascere con confini chiari, prove osservabili e autorizzazioni graduali.

Terraform, invece, va inteso come il mattone “Infrastructure as Code”: non sostituisce Docker Compose, non sostituisce Prometheus, non sostituisce il DevOps specialist. Serve a descrivere e mantenere in modo ripetibile parti dell’infrastruttura: VPS, DNS, firewall, reti, volumi, bucket, secret reference, eventualmente anche dashboard e alert se si usano i provider giusti. La sua utilità non è “fare deploy dell’app”, ma rendere ricostruibile il terreno su cui l’app gira.

Grafana MCP e Prometheus MCP completano il quadro: rendono possibile dare a un agente accesso controllato a metriche, dashboard, alert, log e query PromQL. Questo è il canale naturale attraverso cui uno specialista DevOps può osservare Mercury senza dover ricevere ogni volta dump manuali di log o screenshot. Però sono strumenti da trattare con prudenza: credenziali, permessi, cardinalità delle metriche, timeout delle query e separazione tra read-only e write-capable sono parti centrali del design.

La raccomandazione finale è: **non collegare AWS DevOps Agent direttamente come controller mutante del VPS**. Usarlo come riferimento di architettura e UX, ma costruire per xtrm/Mercury un primitivo più controllato: uno specialista DevOps dedicato, inizialmente read-first e human-in-the-loop, con una pagina DevOps in gitboard/futuro xtrm console, integrazione Prometheus/Grafana MCP, configurazioni per-repo di deployment, e un modello di wakeup a eventi e schedulazione. Solo più avanti, quando substrate sarà maturo, questo può diventare un nodo lungo-vivente.

## Inventario delle fonti

| Fonte | Cosa contribuisce | Concetti / API principali | Rilevanza per xtrm / Mercury |
|---|---|---|---|
| `1-projects/xtrm/research/devops-specialists.md` | Brief locale e intenzione progettuale originale | DevOps specialist, per-repo deploy specialist, pulse emitter, gap IaC/IoT, gap database specialist | È il documento di vincolo: dice quali problemi Mercury vuole risolvere, non solo cosa esiste fuori |
| `inbox/transcripts/Introducing-AWS-DevOps-Agent-Amazon-Web-Services.analysis.md` | Presentazione del modello AWS DevOps Agent | always-on incident response, topology graph, Slack/ServiceNow, MCP custom tools, escalation | Evidenza utile per il modello operativo e il posizionamento del prodotto |
| `inbox/transcripts/AWS-reInvent-2025-Move-beyond-reactive-Transform-cloud-ops-with-AWS-DevOps-Agent-COP362.analysis.md` | Demo e framing più ricco | Agent Spaces, blast radius, read-only posture, subagent paralleli, pricing/caps, support handoff | Fonte migliore per capire fiducia, UX e human-in-the-loop |
| `inbox/transcripts/Diving-Deep-on-AWS-DevOps-Agent-AWS-Tech-Tales.analysis.md` | Dettagli più tecnici su integrazioni e operatività | MCP servers, IAM, read-only mode, prompt steering, parallel investigations, costo | Fonte migliore per confini, ergonomia operativa e costi |
| [AWS DevOps Agent docs](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.html) | Documentazione canonica del prodotto | Agent Spaces, topology graph, CloudWatch, Dynatrace, Datadog, New Relic, Splunk, GitHub/GitLab, Slack, ServiceNow, AWS Support, custom MCP | Modello canonico di come un vendor ha incapsulato un agente operativo |
| [Terraform Docker tutorial](https://developer.hashicorp.com/terraform/tutorials/docker-get-started) | Miniatura didattica del ciclo IaC | `init`, `plan`, `apply`, `destroy`, provider Docker, risorse dichiarative | Utile per spiegare come trasformare operazioni manuali in infrastruttura descritta come codice |
| [Grafana MCP server docs](https://grafana.com/docs/grafana/latest/developer-resources/mcp/) | Ponte tra agente e osservabilità Grafana | dashboard, alert, incidenti, datasource, token di servizio, stdio/SSE/streamable HTTP, read-only mode, TLS | Fortissimo fit con la futura pagina DevOps e con uno specialista read-first |
| [Prometheus MCP server](https://github.com/pab1it0/prometheus-mcp-server) | Ponte tra agente e PromQL | `execute_query`, `execute_range_query`, `list_metrics`, metadata, targets, auth, timeout, stateless HTTP | Fit naturale per metriche di job, code, container, costi token, LSP, Dolt, MCP |
| Ispezione locale di `/home/dawid/projects/mercury/infra` | Stack centrale Mercury già operativo | Traefik, Prometheus, Grafana, Loki, Promtail, Alertmanager, exporter, cAdvisor, network Docker esterne, health-report | Mostra dove il DevOps specialist può agganciarsi subito |
| Ispezione locale di `/home/dawid/projects/mercury/market-data` | Stack applicativo reale con database e feed critici | TimescaleDB, QuestDB, migrazioni, data feed, snapshot feed, options feed, Rust tick ingestor, API, MCP server, backup | Esempio concreto di repo dove Terraform + DevOps specialist possono ridurre drift e rischio deploy |

## Il modello AWS DevOps Agent, distillato

### Non è una chat: è un sistema operativo per incidenti

La cosa più importante da portare a casa da AWS DevOps Agent è che l’agente non viene presentato come una chat generica a cui si chiede “perché è rotto?”. Viene inserito dentro un sistema di contesto. AWS parla di risorse, relazioni, osservabilità, repository, pipeline CI/CD, strumenti esterni e support cases. In altre parole, il modello è: quando arriva un alert o un ticket, l’agente non parte da zero; entra in un ambiente dove conosce già la topologia e può interrogare fonti operative.

Questo è il salto qualitativo rispetto a un agente CLI che riceve soltanto un prompt e qualche log. Il valore nasce dal fatto che il sistema ha già una rappresentazione dei collegamenti: servizio A dipende da database B, il deployment X è avvenuto dieci minuti prima dell’aumento di errori, il container Y ha cambiato immagine, il dashboard Z mostra saturazione. Il LLM diventa utile perché interpreta questi segnali insieme.

Per xtrm/Mercury questo significa che il DevOps specialist deve avere una memoria operativa strutturata. Non basta dargli accesso a `docker ps`. Deve sapere quali repo esistono, quali container sono normali, quali metriche sono canoniche, quali alert sono rumore, quali runbook sono autorizzati, quale deployment è l’ultimo, quali rollback sono possibili.

### Agent Spaces come lezione sul blast radius

AWS usa il concetto di Agent Space per delimitare lo scope. Questo è un dettaglio fondamentale. Un DevOps agent senza perimetro diventa pericoloso perché può mescolare ambienti, account, repo e responsabilità. Un Agent Space è, concettualmente, una stanza operativa con confini di accesso, contesto e responsabilità.

In Mercury l’equivalente dovrebbe essere una combinazione di:

- repo o gruppo di repo;
- ambiente (`local`, `staging`, `vps-prod`);
- tool permessi;
- dashboard e alert rilevanti;
- comandi consentiti;
- runbook associati;
- identità/segreti accessibili;
- regole di escalation.

Uno specialista DevOps per `market-data` non dovrebbe automaticamente avere gli stessi poteri su `infra`, `treasury-cb` o `darth-feedor`. Può leggere segnali cross-stack, ma le azioni devono essere circoscritte.

### UI/UX: una pagina operativa, non solo terminale

Le analisi dei video indicano che AWS punta molto sulla UI. Questo non è cosmetico. Per operazioni e incidenti, una UI buona riduce il carico cognitivo: mostra timeline, servizi coinvolti, ipotesi, evidenze, mitigazioni e follow-up.

Per xtrm questo rafforza l’idea di una pagina DevOps in gitboard/futuro xtrm console. La pagina dovrebbe mostrare almeno:

- deployment attivi e ultimi deployment per repo;
- health check falliti;
- incidenti aperti o investigazioni recenti;
- code e job specialistici;
- worktree sporchi o vecchi;
- consumo token e costo per job/repo;
- stato Dolt, LSP, MCP e database;
- pulsanti di wakeup manuale;
- suggerimenti del DevOps specialist;
- percorso di rollback per servizio.

Il terminale resta utile per l’operatore esperto, ma la superficie decisionale deve essere visiva e sintetica.

### Read-first, human-in-the-loop

Le fonti AWS insistono su un comportamento inizialmente prudente: investigazione, spiegazione, raccomandazione, eventualmente escalation. Questo è esattamente il pattern corretto per Mercury. La prima versione dello specialista DevOps dovrebbe essere read-first: leggere Prometheus, Grafana, Docker, file di health, log, bead, stato Git, stato worktree, stato processi; produrre diagnosi e piano; solo dopo, con policy chiare, eseguire azioni limitate.

Le azioni scriventi dovrebbero essere promosse per gradi:

1. nessuna azione, solo report;
2. azioni locali reversibili, come raccogliere diagnostica;
3. restart controllato di un servizio non critico;
4. deploy tramite comando gated;
5. rollback automatico con soglie forti;
6. mutazioni infrastrutturali solo tramite Terraform plan/apply approvato.

Questo evita che l’agente diventi un “sudo randomizzato”.

## Terraform e Infrastructure as Code nel quadro DevOps

Il tutorial Docker di Terraform è piccolo, ma didatticamente utile perché mostra il ciclo essenziale: si dichiara una risorsa, si inizializza il provider, si pianifica, si applica, si distrugge. La sostanza non è “Terraform sa creare container Docker”; la sostanza è che l’infrastruttura viene trattata come stato dichiarativo.

In Mercury oggi esistono già molte operazioni infrastrutturali codificate, ma distribuite fra documentazione, Makefile, Docker Compose e memoria operativa. Per esempio in `infra/DEPLOY.md` sono descritti passaggi per creare DNS, configurare Cloudflare, installare Docker, creare reti Docker, configurare firewall e avviare stack. Molte di queste operazioni sono state scritte bene, ma restano istruzioni procedurali: una persona deve leggerle ed eseguirle.

Terraform trasformerebbe una parte di quel sapere in codice eseguibile e verificabile. Non tutto. Docker Compose resta perfetto per descrivere i servizi applicativi. Ma risorse come DNS Cloudflare, firewall, bucket R2, server VPS, record, volumi esterni, network condivisi e forse provisioning Grafana/alert possono diventare risorse dichiarative.

La frase chiave è: **Docker Compose descrive cosa gira dentro l’host; Terraform descrive pezzi del mondo in cui quell’host e quei servizi esistono**.

## Osservabilità via Grafana MCP e Prometheus MCP

### Grafana MCP

Grafana MCP è importante perché trasforma Grafana da dashboard umano-centrica a sorgente interrogabile da agente. Può esporre dashboard, alert, incidenti, datasource e query. La documentazione menziona token di servizio, basic auth, transport `stdio`, `SSE` e `streamable-http`, modalità read-only, allow/deny dei tool e TLS.

Per Mercury il default dovrebbe essere severo: token di servizio dedicato, permessi minimi, read-only mode dove possibile, e tool allowlist. Uno specialista DevOps non deve poter modificare dashboard e alert nella prima fase. Deve poter leggere, correlare e spiegare.

Esempio di uso sano:

- “mostrami gli alert attivi”;
- “dammi i pannelli principali del dashboard market-data”;
- “trova il datasource Prometheus giusto”;
- “apri un deeplink al grafico rilevante”;
- “riassumi cosa è cambiato negli ultimi 30 minuti”.

Esempio da evitare nella prima fase:

- “modifica alert rule in produzione”;
- “crea dashboard automaticamente”;
- “cambia datasource”;
- “scrivi annotazioni senza conferma”.

### Prometheus MCP

Prometheus MCP è il ponte più diretto alle metriche. Espone query istantanee, query su range, lista metriche, metadata e target. Per un DevOps specialist questo è il modo naturale di rispondere a domande come:

- quali container stanno consumando più CPU;
- quale servizio ha riavvii recenti;
- se un endpoint è sparito dai target;
- se la latenza è aumentata dopo un deployment;
- se una coda cresce;
- se il consumo token/costo supera budget;
- se i job specialistici restano troppo in waiting.

Il rischio è la cardinalità. Un agente che lancia PromQL larghe può generare output ingestibile. Per questo servono query predefinite, dashboard canonici, nomi metriche normalizzati, timeout brevi e sintesi progressiva: prima scoprire metriche, poi query mirata, poi range limitato.

### Metriche minime per xtrm/Mercury

Lo specialista DevOps dovrebbe poter vedere almeno:

- numero di specialisti attivi;
- job running/waiting/error;
- durata media dei job;
- processi orfani;
- worktree aperti, vecchi, sporchi;
- server Dolt attivi e stato backup/sync;
- LSP attivi, crash, memoria;
- MCP server uptime, errori, latenza;
- uso token per modello/repo/workflow;
- costo stimato per job e per repo;
- container restart count;
- stato database TimescaleDB/QuestDB/Postgres;
- backup age;
- deployment timestamp e health post-deploy.

## Modello di responsabilità dello specialista DevOps

### CI/CD e monitoring sono separati, ma collegati

La domanda nel brief originale era: CI/CD è separato dal monitoring? Sì, concettualmente sì. CI/CD è la pipeline che porta una modifica dal commit alla produzione: build, test, scan, artifact, deploy, health check, rollback. Monitoring è il sistema che osserva il comportamento dopo e durante l’esecuzione: metriche, log, alert, dashboard, SLO.

Ma DevOps vive proprio nel ponte tra i due. Un alert post-deploy deve poter dire: “questo errore è iniziato cinque minuti dopo il commit X, nel servizio Y, con immagine Z, e il rollback sicuro è il comando W”. Senza CI/CD, il monitoring vede sintomi ma non sa quale cambiamento li ha causati. Senza monitoring, la CI/CD può deployare correttamente qualcosa che degrada in produzione.

Per Mercury conviene tenere moduli distinti:

- deployment specialist: conosce il repo e il rilascio;
- monitoring/observability: raccoglie segnali;
- DevOps specialist: correla, decide, propone, coordina;
- database specialist: protegge schema, dati e backup.

### Confini tra DevOps specialist, deployment specialist e database specialist

**Deployment specialist** per-repo:

- sa costruire e rilasciare quel repo;
- conosce test obbligatori;
- conosce health check post-deploy;
- sa rollbackare;
- sa quali comandi sono vietati;
- gestisce `make spdeploy` o equivalente.

**DevOps specialist** cross-platform:

- conosce lo stato complessivo della piattaforma;
- monitora code, runner, container, LSP, Dolt, MCP, Grafana, Prometheus;
- sveglia deployment specialist o database specialist quando serve;
- produce RCA e prevenzione;
- mantiene la pagina DevOps;
- guarda costo e capacità.

**Database specialist**:

- schema e migrazioni;
- backup/restore;
- replica;
- performance query;
- consistenza dati;
- sicurezza dati;
- runbook per recovery.

Fondere tutto in un solo agente produrrebbe un “super-operatore” troppo ampio. Meglio orchestrare specialisti più stretti.

## Raccomandazione architetturale per xtrm/Mercury

### AWS DevOps Agent diretto sul VPS?

No, non come controller di produzione. Può essere usato come ispirazione, benchmark o eventualmente piano read-only/curated, ma non dovrebbe ricevere subito poteri mutanti sul VPS. Il motivo è il raggio d’azione: Mercury ha molti repo, reti Docker condivise, database persistenti, segreti, feed dati e servizi MCP. Prima vanno costruiti perimetro, osservabilità, rollback e policy.

La via migliore è costruire un DevOps specialist nativo per xtrm/Mercury, modellato sulle lezioni AWS ma adattato alla realtà locale.

### Container dedicato o dentro specialists-service?

Nel breve periodo lo specialista può vivere dentro `specialists-service` se opera come agente read-only e usa pochi strumenti. Ma appena deve avere accesso stabile a Prometheus/Grafana MCP, worktree, deploy hooks, Docker socket controllato e segreti separati, conviene un container dedicato.

Il container dedicato permette:

- confini di rete più chiari;
- secret mount dedicati;
- tool allowlist più stretta;
- osservabilità propria;
- policy per ambiente;
- riavvio indipendente;
- audit separato.

`specialists-service` resta orchestratore. `devops-specialist` diventa il cervello operativo.

### Pagina DevOps in gitboard/futuro xtrm console

Sì, serve. Dovrebbe diventare la console di stato operativo. Non deve necessariamente essere complessa nella prima versione. Anche una pagina con stato deployment, health, alert, costi token, code, worktree e pulsanti wakeup sarebbe già molto utile.

Il punto non è solo visualizzare. È creare una superficie condivisa tra umano e agente. Quando il DevOps specialist dice “vedo aumento errori su mmd-api dopo deploy”, la UI deve mostrare il grafico, il commit, il container, il log e l’azione proposta.

### Wakeup a eventi e schedulazione

Il brief originale parla di un pulse emitter. È il pattern giusto. Lo specialista non deve essere sempre sveglio per forza. Prima può essere risvegliato da eventi:

- post-deploy;
- health check fallito;
- alert Prometheus;
- crescita coda/job waiting;
- aumento consumo token;
- processo orfano;
- Dolt/LSP/MCP fuori soglia;
- backup vecchio;
- drift Terraform;
- divergenza Git pericolosa.

E da schedulazioni:

- sweep mattutino;
- controllo post-market;
- report costo giornaliero;
- scansione drift settimanale;
- verifica backup;
- prevenzione incidenti.

## Esempi concreti da Mercury infra e market-data

### Stato osservato in `mercury/infra`

`/home/dawid/projects/mercury/infra` è già molto vicino al ruolo di piattaforma centrale. Il `docker-compose.yml` espone Traefik, API gateway, Prometheus, Grafana, Loki, Promtail, Alertmanager, exporter Postgres/Redis, node-exporter e cAdvisor. Ha reti esterne condivise (`mercury_dev_network`, `mmd-network`, `treasury-network`, `website-network`) e volumi persistenti nominati (`mercury_platform_prometheus`, `mercury_platform_grafana`, `mercury_traefik_acme`, ecc.). Il `Makefile` crea manualmente le reti Docker e avvia lo stack. `DEPLOY.md` documenta provisioning VPS, Cloudflare, DNS, token, UFW e comandi Docker.

Questo è un caso perfetto in cui Terraform può migliorare la parte “fuori da Compose”. Docker Compose deve continuare a descrivere i servizi. Terraform può invece assumere responsabilità su:

- record DNS Cloudflare;
- token/secret references dove possibile;
- firewall/UFW o regole cloud se il provider VPS le espone;
- bucket R2 per backup;
- volumi esterni critici se si decide di gestirli dichiarativamente;
- directory e file bootstrap tramite provider appropriati o script controllati;
- maybe Grafana dashboards/alert se si usa provider Grafana e si accetta quel perimetro;
- inventario VPS e output utili al deployment.

Esempio: oggi `DEPLOY.md` dice di creare record Cloudflare manualmente. Terraform potrebbe contenere:

```hcl
resource "cloudflare_dns_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  content = var.vps_ipv4
  type    = "A"
  proxied = true
}
```

Il beneficio non è digitare meno. Il beneficio è che un `terraform plan` mostra se DNS reale e DNS desiderato divergono.

### Stato osservato in `mercury/market-data`

`/home/dawid/projects/mercury/market-data` è un repo applicativo molto più ricco: TimescaleDB, QuestDB, servizio migrazioni, data feed, snapshot feed, options feed, tick ingestor Rust, API, MCP server, backup service e tester d’integrazione. Ha database persistenti, feed schedulati, volumi esterni e dipendenze cross-repo come il bind mount verso `barchart-scraper` e Sierra Chart data.

Qui Terraform non dovrebbe sostituire il compose applicativo. Sarebbe eccessivo e poco ergonomico. Però potrebbe migliorare tre cose:

1. **Prerequisiti esterni**: reti Docker esterne, volumi esterni, directory host per bind mount, bucket backup, DNS/route per API/MCP.
2. **Drift detection**: verificare che ciò che il repo si aspetta esista davvero sul VPS.
3. **Ambiente replicabile**: se si crea una seconda VPS o staging, i prerequisiti non vengono ricostruiti a memoria.

Per esempio `market-data/docker-compose.yml` usa volumi esterni come `mercury_tick_state` e `mercury_appuser_home`, e bind mount assoluti come `/home/dawid/projects/mercury/sierra-vps/sierra_data/SierraChart/Data`. Queste dipendenze oggi sono conoscenza implicita del VPS. Terraform o un modulo IaC leggero potrebbe dichiararle come prerequisiti e produrre output/checklist.

### Come si inserisce il DevOps specialist in questi due repo

Nel caso `infra`, il DevOps specialist è quasi il proprietario naturale: è il repo che contiene la piattaforma osservabile. Qui lo specialista dovrebbe leggere Prometheus/Grafana, verificare salute di Traefik, Alertmanager, Loki, exporter, cAdvisor, e generare report operativi. Potrebbe anche proporre modifiche di dashboard o alert, ma non applicarle senza review.

Nel caso `market-data`, invece, lo specialista DevOps dovrebbe coordinarsi con un deployment specialist per-repo e con un database specialist. Se `mmd-snapshot-feed` va in errore, DevOps legge alert, log e metriche; se sospetta migrazione schema, chiama database specialist; se serve redeploy, chiama deployment specialist o usa `make spdeploy` quando esisterà.

Esempio di flusso futuro:

```text
Git push su market-data
  ↓
CI passa test + typecheck + security scan
  ↓
Deployment specialist esegue make spdeploy
  ↓
DevOps specialist viene svegliato post-deploy
  ↓
Prometheus/Grafana: verifica error rate, restart, latency, DB health
  ↓
Se tutto ok: annota deployment come sano
  ↓
Se degrada: propone rollback o coinvolge DB specialist
```

## Roadmap operativa

### Fase 0 — validazione ricerca e inventario

- Inventariare repo Mercury e servizi effettivamente attivi.
- Mappare per ogni repo: deploy command, rollback, health check, dashboard, alert, owner.
- Decidere quali comandi Docker diretti sono permessi e quali devono passare da `make spdeploy`.
- Identificare metriche già disponibili e metriche mancanti.
- Stabilire confini tra DevOps, deployment specialist e database specialist.

### Fase 1 — primitivo manuale

- Creare una prima definizione `devops-specialist` read-only.
- Far leggere allo specialista `SERVICE_HEALTH.md`, Prometheus, Grafana e `docker compose ps` controllato.
- Aggiungere una pagina DevOps minima a gitboard/xtrm console.
- Aggiungere wakeup manuale: “investiga market-data”, “investiga infra”, “post-deploy check”.

### Fase 2 — metriche e dashboard

- Integrare Grafana MCP in read-only.
- Integrare Prometheus MCP con query allowlist.
- Aggiungere metriche mancanti per specialisti, job, worktree, Dolt, LSP, MCP, token/costi.
- Creare dashboard canonici per `infra`, `market-data`, specialists-service e costi.

### Fase 3 — deployment gated

- Introdurre `make spdeploy` per repo.
- Bloccare o scoraggiare `docker compose up` diretto fuori dai runbook autorizzati.
- Prevedere pre-check, deploy, post-check, rollback.
- Generare un record deployment leggibile dal DevOps specialist.

### Fase 4 — Terraform/IaC MVP

- Non partire da tutto il mondo. Partire da Cloudflare DNS + bucket backup + inventario prerequisiti Docker.
- Aggiungere `terraform plan` come controllo drift, non come mutazione automatica.
- Applicare solo con conferma umana.
- Collegare output Terraform alla pagina DevOps.

### Fase 5 — nodo substrate lungo-vivente

- Promuovere lo specialista a nodo con memoria operativa.
- Wakeup schedulati e a evento.
- Prevenzione incidenti basata su storico.
- Coordinamento automatico con deployment/database/security specialist.

## Rischi e domande aperte

### Rischi

- dare capacità mutanti troppo presto;
- mischiare repo e ambienti;
- esporre token Grafana/Prometheus/Cloudflare;
- interrogare Prometheus con query troppo larghe;
- creare drift tra Compose, Terraform e documentazione;
- rendere `make spdeploy` un wrapper opaco invece di un gate verificabile;
- confondere infrastruttura host con deploy applicativo;
- rompere volumi persistenti se Terraform viene usato senza disciplina.

### Domande aperte

- Qual è il primo repo candidato per `make spdeploy`?
- La pagina DevOps deve vivere in gitboard attuale o nel futuro xtrm console?
- Quali metriche specialist/job sono già esposte e quali vanno aggiunte?
- Grafana MCP va montato nel devops-specialist container o esposto come servizio MCP centrale?
- Terraform state dove va tenuto: locale cifrato, S3/R2, Terraform Cloud, altro backend?
- Chi approva `terraform apply` in produzione?
- Database specialist deve essere un MCP dedicato o uno specialista con strumenti SQL limitati?

## Beads proposti

| Priorità | Titolo proposto | Descrizione |
|---|---|---|
| P0 | Definire confini e command surface del DevOps specialist | Bloccare scope, permessi, read-only default, escalation, comandi vietati e comandi consentiti |
| P0 | Aggiungere pagina DevOps a gitboard / xtrm console | Mostrare deploy, incidenti, health, code, token/costi, Dolt/LSP/MCP, wakeup manuali |
| P0 | Prototipare Prometheus + Grafana MCP read-only | Esporre metriche e dashboard a uno specialista senza poteri mutanti |
| P1 | Disegnare configurazione deployment per-repo | Ogni repo dichiara deploy, rollback, health check, dashboard, alert, owner |
| P1 | Implementare `make spdeploy` per un repo pilota | Sostituire deploy manuale con flusso gated pre/post-check |
| P1 | Aggiungere dashboard token/costi | Tracciare costo per job, modello, repo e workflow |
| P2 | Creare pulse emitter eventi/schedule | Svegliare DevOps specialist su deploy, incidenti, drift, queue spike e schedule |
| P2 | Definire scope del database specialist | Separare schema/migrazioni/backup/restore da DevOps generico |
| P2 | Valutare container dedicato devops-specialist | Confrontare embedding in specialists-service vs container dedicato |
| P2 | Prototipare Terraform MVP per Mercury infra | Gestire Cloudflare DNS, bucket backup e prerequisiti VPS in modalità plan-first |

# Guida operazionale a Terraform

## Che cos’è Terraform

Terraform è uno strumento di Infrastructure as Code. Questa definizione può sembrare astratta, quindi conviene tradurla in termini pratici: Terraform ti permette di scrivere in file di testo lo stato desiderato di una parte dell’infrastruttura, poi confronta quei file con ciò che esiste davvero e produce un piano di cambiamento.

La cosa più importante è che Terraform non ragiona come uno script imperativo. Uno script dice: “fai questo, poi questo, poi questo”. Terraform dice: “questo oggetto deve esistere con queste proprietà”. Poi è Terraform a decidere quali operazioni sono necessarie per arrivarci.

Questa differenza è enorme. Se in uno script hai:

```bash
docker network create mmd-network
```

lo script prova a creare una rete. Se la rete esiste già, devi gestire tu l’errore o aggiungere `|| true`. In Terraform invece dichiari una risorsa, e lo state dice se quella risorsa è già gestita, se va creata, se va modificata o se è sparita.

## Il ciclo mentale: desiderato, reale, differenza

Terraform lavora su tre livelli:

1. **Configurazione desiderata**: i file `.tf`.
2. **Stato conosciuto**: il file di state, che mappa risorse Terraform a risorse reali.
3. **Mondo reale**: provider esterni come Docker, Cloudflare, AWS, Grafana, VPS provider.

Quando esegui `terraform plan`, Terraform legge la configurazione, legge lo state, interroga i provider, e calcola la differenza. Il risultato è un piano:

```text
Plan: 3 to add, 1 to change, 0 to destroy.
```

Questo piano è il momento più importante del workflow. È il punto in cui l’umano e, in futuro, il DevOps specialist possono verificare se Terraform sta per fare qualcosa di sensato.

## Provider

Un provider è il plugin che sa parlare con un sistema esterno. Terraform da solo non sa creare un record DNS o un container. Lo sa fare tramite provider.

Esempi:

- provider Docker: parla con Docker;
- provider Cloudflare: gestisce DNS, zone, record;
- provider AWS: gestisce EC2, S3, IAM, VPC;
- provider Grafana: gestisce dashboard, datasource, alert;
- provider PostgreSQL: può gestire ruoli, database, privilegi;
- provider random: genera password o stringhe casuali.

Esempio minimalista:

```hcl
terraform {
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

provider "docker" {}
```

Qui si sta dicendo: questo progetto usa il provider Docker.

## Resource

Una resource è un oggetto gestito. Può essere un container, un record DNS, una VM, un bucket, un firewall rule, un dashboard.

Esempio con Docker:

```hcl
resource "docker_image" "nginx" {
  name = "nginx:latest"
}

resource "docker_container" "web" {
  name  = "example-web"
  image = docker_image.nginx.image_id

  ports {
    internal = 80
    external = 8080
  }
}
```

Questo dice: voglio un’immagine nginx e un container che la usa. Se il container non esiste, Terraform lo crea. Se cambi porta o immagine, Terraform calcola cosa modificare.

## Data source

Una data source non crea nulla. Legge qualcosa che esiste già. È utile quando vuoi collegarti a infrastruttura esistente senza prenderne piena proprietà.

Esempio concettuale:

```hcl
data "cloudflare_zone" "mercury" {
  name = "mercuryintelligence.net"
}
```

Qui Terraform non crea la zona. La trova e usa il suo ID per creare record.

## Variabili

Le variabili rendono il progetto riutilizzabile.

```hcl
variable "vps_ipv4" {
  type        = string
  description = "Indirizzo IPv4 pubblico del VPS Mercury"
}
```

Poi puoi usarla:

```hcl
resource "cloudflare_dns_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  content = var.vps_ipv4
  type    = "A"
  proxied = true
}
```

Le variabili possono arrivare da file `.tfvars`, environment variables o CLI. I segreti non vanno committati.

## Output

Gli output sono valori che Terraform espone dopo `apply`.

```hcl
output "api_url" {
  value = "https://api.mercuryintelligence.net"
}
```

Per Mercury, gli output potrebbero essere utili alla pagina DevOps:

- IP VPS;
- domini gestiti;
- bucket backup;
- nomi volumi;
- endpoint Grafana/Prometheus;
- record DNS attivi.

## State

Lo state è il cuore delicato di Terraform. È il file che dice: “questa resource Terraform corrisponde a questa risorsa reale”. Senza state, Terraform non sa cosa controlla.

Esempio mentale:

```text
cloudflare_dns_record.api -> record id abc123
docker_network.mmd -> network id 4f2...
```

Per un progetto personale locale, si può iniziare con state locale. Per produzione e più macchine, serve molta più disciplina. Se lo state viene sincronizzato male tra VPS e laptop, si rischiano piani sbagliati. Nel tuo caso, dato che usi Syncthing tra VPS e macchine locali, **lo state Terraform non dovrebbe essere sincronizzato alla leggera**. Meglio un backend remoto esplicito, o una regola molto chiara: un solo luogo applica, gli altri leggono.

In pratica:

- non committare `terraform.tfstate`;
- non affidarlo a Syncthing senza lock;
- usare un backend remoto quando si passa a produzione;
- proteggere lo state perché può contenere segreti.

## I comandi essenziali

### `terraform init`

Inizializza il progetto, scarica provider, configura backend.

```bash
terraform init
```

Si esegue all’inizio e quando cambi provider/backend.

### `terraform fmt`

Formatta i file.

```bash
terraform fmt
```

### `terraform validate`

Controlla sintassi e coerenza base.

```bash
terraform validate
```

### `terraform plan`

Mostra cosa succederebbe.

```bash
terraform plan
```

In produzione, questo dovrebbe essere obbligatorio e salvato come artifact.

### `terraform apply`

Applica davvero.

```bash
terraform apply
```

Per flussi più controllati:

```bash
terraform plan -out=tfplan
terraform apply tfplan
```

### `terraform destroy`

Distrugge le risorse gestite.

```bash
terraform destroy
```

Questo comando va trattato come pericoloso. In un DevOps specialist dovrebbe essere hard-denied o richiedere conferma umana forte.

## Come Terraform potrebbe migliorare Mercury infra

Nel repo `mercury/infra`, Terraform potrebbe iniziare da ciò che oggi è documentato in `DEPLOY.md` ma ancora manuale.

### Caso 1: DNS Cloudflare

Oggi il deploy guide elenca record `@`, `www`, `api`, `mcp`, `monitor`, `traefik`, `portainer`. Questi sono perfetti per Terraform.

Esempio concettuale:

```hcl
locals {
  mercury_records = toset([
    "@",
    "www",
    "api",
    "mcp",
    "monitor",
    "traefik",
    "portainer",
  ])
}

resource "cloudflare_dns_record" "mercury_a" {
  for_each = local.mercury_records

  zone_id = var.cloudflare_zone_id
  name    = each.key
  content = var.vps_ipv4
  type    = "A"
  proxied = true
}
```

Beneficio operativo: se un record manca, è puntato all’IP sbagliato o è proxyato male, `terraform plan` lo mostra.

### Caso 2: prerequisiti Docker esterni

`infra/Makefile` crea reti esterne:

```bash
docker network create mercury_dev_network
docker network create mmd-network
docker network create treasury-network
docker network create website-network
```

Terraform potrebbe gestire o almeno verificare queste reti. Però qui bisogna scegliere: se Docker Compose e Makefile già funzionano bene, si può iniziare usando Terraform solo come documentazione/check dei prerequisiti, non come owner totale.

### Caso 3: bucket backup R2

`market-data` ha un backup service con credenziali R2. La creazione del bucket e policy può essere gestita via Terraform, se si decide di formalizzarla. Questo è un buon candidato perché è infrastruttura esterna e critica.

### Caso 4: Grafana dashboards e alert

Grafana ha provider Terraform. In futuro si potrebbero versionare dashboard e alert. Ma questa è una seconda fase: prima leggere con Grafana MCP, poi decidere se gestire dashboard/alert come codice. Il rischio è creare drift tra dashboard modificate a mano e dashboard gestite da Terraform.

## Come Terraform potrebbe migliorare market-data

`market-data` è un esempio eccellente di repo dove l’applicazione è già Docker Compose-heavy e non va riscritta in Terraform. Il miglioramento sta nei bordi.

### Prerequisiti espliciti

`market-data/docker-compose.yml` dipende da:

- rete esterna `mmd-network`;
- rete esterna `mercury_dev_network`;
- rete esterna `mercury_platform`;
- volumi persistenti `mercury_timescaledb_data`, `mercury_tick_state`, `mercury_appuser_home`, `mercury_questdb_data`, `mercury_backup_data`;
- path host `/home/dawid/projects/mercury/barchart-scraper`;
- path host `/home/dawid/projects/mercury/sierra-vps/sierra_data/SierraChart/Data`;
- segreti in `.env`;
- API cross-stack come `econ-api`, `econ_calendar_api`, `host.docker.internal`.

Terraform o un modulo IaC può rendere questi prerequisiti espliciti, verificabili e replicabili.

### Ambiente staging

Se domani vuoi un secondo ambiente staging, manualmente dovresti ricordarti reti, volumi, record, porte, path, bucket e segreti. Terraform può creare una variante parametrizzata:

```hcl
variable "environment" {
  type    = string
  default = "staging"
}
```

E poi nominare risorse in modo coerente:

```hcl
locals {
  prefix = "mercury-${var.environment}"
}
```

Questo riduce il rischio di staging che accidentalmente tocca produzione.

### Drift detection pre-deploy

Un futuro `make spdeploy` potrebbe fare:

```bash
terraform plan -detailed-exitcode
```

Semantica:

- exit `0`: nessun drift;
- exit `2`: ci sono cambiamenti;
- exit `1`: errore.

Se c’è drift inatteso, il deployment specialist si ferma e chiama il DevOps specialist.

## Come il DevOps specialist userebbe Terraform

Il DevOps specialist non dovrebbe partire con `terraform apply` automatico. Dovrebbe usare Terraform così:

1. leggere il modulo Terraform;
2. eseguire `terraform fmt -check`;
3. eseguire `terraform validate`;
4. eseguire `terraform plan`;
5. sintetizzare il piano in linguaggio umano;
6. evidenziare distruzioni, sostituzioni, cambiamenti DNS/firewall/volumi;
7. chiedere approvazione;
8. solo in fase matura, applicare piani allowlisted.

Esempio di output desiderato:

```text
Terraform plan summary:
- 1 DNS record will change: api.mercuryintelligence.net -> 159.195.49.110
- 0 resources will be destroyed
- 0 persistent volumes affected
- 0 firewall rules removed
Risk: LOW
Recommendation: safe to apply after DNS check
```

Se invece vede:

```text
- docker_volume.mercury_timescaledb_data will be destroyed
```

allora deve fermarsi immediatamente.

## Regole di sicurezza per Terraform in xtrm/Mercury

1. `terraform destroy` vietato agli agenti.
2. `terraform apply` solo con piano salvato e approvazione umana.
3. Stato remoto o locale protetto, mai sincronizzato casualmente via Syncthing.
4. Nessun segreto in `.tf` o `.tfvars` committati.
5. Moduli separati per DNS, backup, VPS, Grafana, Docker prereq.
6. Produzione e staging con state separati.
7. Ogni piano deve essere riassunto dal DevOps specialist.
8. Ogni risorsa persistente deve avere policy di protezione.
9. Le risorse database/volumi non si distruggono senza procedura manuale.
10. Terraform non sostituisce backup e restore testati.

## Primo MVP consigliato

Il primo MVP Terraform per Mercury non dovrebbe provare a gestire tutti i container. Dovrebbe essere piccolo:

```text
infra/terraform/
  cloudflare-dns/
  r2-backups/
  docker-prereqs/
```

Con obiettivo:

- dichiarare DNS Cloudflare principali;
- dichiarare bucket R2 backup;
- verificare/creare reti Docker esterne se si decide;
- produrre output leggibili dalla pagina DevOps;
- usare `plan` come controllo drift.

Questo darebbe valore subito senza mettere a rischio il runtime applicativo.

## Conclusione operazionale

Terraform è il registro dichiarativo del terreno. Docker Compose è il runtime dei servizi. Prometheus/Grafana sono gli occhi. Il DevOps specialist è il coordinatore che legge questi segnali, capisce il rischio e propone o esegue azioni controllate. In Mercury la sequenza più sicura è: osservabilità prima, specialist read-only poi, deployment gated dopo, Terraform plan-first per il perimetro infrastrutturale, apply automatico solo molto più avanti.
