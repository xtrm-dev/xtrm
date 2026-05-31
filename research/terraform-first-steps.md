---
title: terraform-first-steps
aliases:
  - Primi passi Terraform
  - Terraform per Mercury market-data
  - Terraform operativo per DevOps specialist
date_created: 2026-05-31
date_modified: 2026-05-31
---

# Terraform first steps per Mercury

Questo documento raccoglie il ragionamento operativo su dove Terraform si inserirebbe in servizi Mercury come `market-data`, senza confonderlo con Docker Compose, con il deployment applicativo o con il futuro DevOps specialist.

La domanda centrale è: se `market-data` oggi gira già con Docker Compose, che cosa aggiunge Terraform? La risposta breve è che Terraform non dovrebbe gestire il cuore vivo del servizio. Non dovrebbe diventare il posto dove descriviamo i feed Python, l’API, il server MCP, le migrazioni Alembic o il tick ingestor Rust. Quella parte resta correttamente in `docker-compose.yml` e nei Makefile del repo.

Terraform serve invece a descrivere e verificare il terreno intorno al servizio: reti Docker esterne, volumi persistenti, DNS, bucket backup, prerequisiti host, separazione staging/produzione e drift infrastrutturale prima del deploy. In altre parole, Terraform non risponde alla domanda “quali container devo avviare?”, ma alla domanda “l’ambiente su cui sto per avviare questi container è quello che penso?”.

## La distinzione fondamentale

Per un servizio come `market-data`, Docker Compose è lo strumento naturale per il runtime applicativo. Il compose descrive che devono esistere container come `mmd-timescaledb`, `mmd-questdb`, `mmd-data-feed`, `mmd-snapshot-feed`, `mmd-options-feed`, `mmd-tick-ingestor-rust`, `mmd-api`, `mmd-mcp-server` e `mmd-backup-service`. Dentro quel file troviamo immagini, build context, healthcheck, variabili ambiente, reti, volumi, logging e dipendenze fra container.

Terraform non deve duplicare questo. Se provassimo a riscrivere tutto il runtime applicativo in Terraform, otterremmo un sistema più rigido e meno leggibile. Docker Compose è fatto per descrivere processi/container su una macchina. Terraform è fatto per descrivere risorse infrastrutturali e confrontarle con lo stato reale.

La divisione sana è questa:

```text
Docker Compose  -> processi applicativi e container
Terraform       -> prerequisiti e risorse esterne
Prometheus      -> metriche e salute runtime
Grafana         -> dashboard, alert e investigazione visuale
DevOps specialist -> coordinamento, spiegazione, preflight, post-deploy, escalation
```

Pensare Terraform come un secondo Docker Compose è un errore. Pensarlo come contratto verificabile del terreno operativo è molto più utile.

## Il problema: Compose presume molto

Un file `docker-compose.yml` spesso sembra autosufficiente, ma non lo è davvero. Molte righe dicono implicitamente: “questa cosa deve già esistere”.

Nel caso `market-data`, le reti esterne sono un esempio chiaro. Se il compose dichiara `mmd-network`, `mercury_dev_network` o `mercury_platform` come reti esterne, significa che non le sta creando lui. Sta assumendo che qualcuno le abbia già create sul VPS. Se una rete manca, il deploy fallisce. Se una rete esiste con nome diverso o è stata ricreata male, i container possono partire ma non comunicare correttamente con gli altri stack.

Lo stesso vale per i volumi. Un volume come `mercury_timescaledb_data` non è un dettaglio: contiene dati. Se quel volume non esiste, esiste col nome sbagliato o viene distrutto, il comportamento del servizio cambia in modo radicale. Il compose lo monta, ma non è un sistema di governance dei volumi critici.

Poi ci sono i path assoluti dell’host. Se `market-data` monta una directory Sierra Chart o un repo sibling come `barchart-scraper`, il compose presume che quel path sia presente sul VPS, aggiornato, accessibile e con permessi corretti. Se il path non esiste, il servizio può fallire; peggio, Docker può creare una directory vuota e il problema emerge solo più tardi come errore applicativo.

Infine ci sono risorse esterne al VPS: record DNS Cloudflare, bucket R2, policy backup, routing Traefik, endpoint pubblici, segreti e credenziali. Queste risorse non vivono nel compose di `market-data`, ma il servizio dipende da loro.

Terraform serve a trasformare queste assunzioni in dichiarazioni esplicite.

## Terraform come contratto operativo

Il modo più utile di introdurre Terraform è trattarlo come contratto operativo. Il contratto dice: per far girare `market-data` in produzione, devono esistere certe reti, certi volumi, certi bucket, certi record DNS, certi path e certi output.

La differenza fra un contratto Terraform e un README è che Terraform può confrontare la dichiarazione con il mondo reale. Se il DNS non punta all’IP atteso, `terraform plan` lo mostra. Se manca un bucket backup, il piano lo mostra. Se una risorsa sarebbe distrutta, il piano lo mostra prima che succeda.

Questa capacità è preziosa soprattutto nel pre-deploy. Prima di lanciare una nuova versione applicativa, non voglio scoprire a runtime che l’ambiente è incompleto. Voglio sapere prima se il terreno è coerente.

## Il flusso operativo corretto

Un futuro deploy sano di `market-data` non dovrebbe essere semplicemente:

```bash
docker compose up -d --build
```

Un flusso più robusto sarebbe:

```text
1. Il deployment specialist verifica repo, test, typecheck e build.
2. Il DevOps specialist esegue il preflight infrastrutturale.
3. Terraform controlla drift su DNS, bucket, reti, volumi e prerequisiti.
4. Il piano viene sintetizzato in linguaggio umano.
5. Se non ci sono rischi, parte il deploy applicativo.
6. Dopo il deploy, Prometheus/Grafana verificano salute e regressioni.
7. Se qualcosa degrada, il DevOps specialist propone rollback o escalation.
```

Il comando chiave di Terraform in questa fase è:

```bash
terraform plan -detailed-exitcode
```

La semantica è utile per automazione e agenti:

```text
exit 0 -> nessun cambiamento, infrastruttura allineata
exit 2 -> c'è drift o ci sono cambiamenti da applicare
exit 1 -> errore
```

Se il risultato è `0`, il deploy può continuare. Se è `2`, il DevOps specialist deve spiegare il drift. Non è detto che sia un errore, ma è una condizione da capire. Se è `1`, il deploy dovrebbe fermarsi.

## Reti Docker esterne

Le reti sono il primo candidato perché sono semplici e a basso rischio. `market-data` dipende da reti condivise per parlare con altri stack Mercury e con la piattaforma centrale. Oggi queste reti possono essere create da un Makefile con comandi come:

```bash
docker network create mmd-network
docker network create mercury_dev_network
```

Questo funziona, ma resta procedurale. Qualcuno deve ricordarsi di farlo. Qualcuno deve ricordarsi quali reti servono. Su una seconda macchina o su staging bisogna ripetere correttamente la procedura.

Terraform può dichiarare queste reti come parte del contratto:

```hcl
resource "docker_network" "mmd" {
  name = "mmd-network"
}

resource "docker_network" "mercury_dev" {
  name = "mercury_dev_network"
}

resource "docker_network" "platform" {
  name = "mercury_platform"
}
```

Il vantaggio non è solo creare le reti. Il vantaggio è poter chiedere: “queste reti esistono davvero?”. Se mancano, Terraform lo dice prima che Compose fallisca.

Per produzione, bisogna decidere se Terraform deve essere owner effettivo delle reti o solo parte del preflight. In un primo MVP, va bene anche un approccio prudente: Terraform documenta/verifica, il Makefile continua a creare. Ma nel tempo è più pulito avere una sola fonte di verità.

## Volumi persistenti

I volumi sono molto più delicati. `market-data` usa volumi per TimescaleDB, QuestDB, stato del tick ingestor e backup. Qui Terraform può aiutare, ma deve essere configurato con disciplina.

Un volume dati non deve essere trattato come una risorsa qualsiasi. Se Terraform crea o gestisce un volume persistente, deve avere protezioni esplicite. In particolare, per volumi critici dovrebbe esserci `prevent_destroy`:

```hcl
resource "docker_volume" "timescaledb_data" {
  name = "mercury_timescaledb_data"

  lifecycle {
    prevent_destroy = true
  }
}
```

Questo dice a Terraform: anche se un piano futuro volesse distruggere questo volume, fermati. Non farlo automaticamente.

Il DevOps specialist dovrebbe considerare qualunque piano che tocca volumi persistenti come rischio alto o critico. Anche un semplice rename può essere pericoloso, perché dal punto di vista del container un volume con nome diverso equivale a un database diverso.

Per questo il primo uso di Terraform sui volumi dovrebbe essere conservativo: dichiarare, verificare, proteggere. Non automatizzare distruzioni, non ricreare a cuor leggero, non usare `destroy` come operazione normale.

## Path host e bind mount

`market-data` monta anche directory dal filesystem dell’host. Questo è un punto cieco tipico dei sistemi Docker Compose. Il container può richiedere un path come:

```text
/home/dawid/projects/mercury/barchart-scraper
/home/dawid/projects/mercury/sierra-vps/sierra_data/SierraChart/Data
```

Questi path non sono container, ma senza di loro alcuni servizi non funzionano. Il tick ingestor, per esempio, dipende dai dati Sierra. L’options feed dipende da un repo sibling. Se quei path mancano o hanno permessi sbagliati, il problema appare come errore applicativo, ma la causa è infrastrutturale.

Terraform non è sempre lo strumento più elegante per gestire directory locali, soprattutto su un singolo VPS. Però può registrare questi path come variabili e output, oppure collaborare con script di preflight. L’obiettivo è renderli espliciti.

Un controllo operativo minimo potrebbe essere:

```bash
test -d /home/dawid/projects/mercury/barchart-scraper
test -d /home/dawid/projects/mercury/sierra-vps/sierra_data/SierraChart/Data
```

Un controllo migliore verificherebbe anche permessi, ownership, freschezza dei dati e leggibilità dal container. Il DevOps specialist può orchestrare questi check come parte del preflight.

## DNS, routing e Traefik

`market-data` ha servizi come API e MCP server, ma il fatto che siano raggiungibili dall’esterno dipende da più livelli. Il container deve essere vivo. Traefik deve avere la route corretta. Il DNS Cloudflare deve puntare all’IP corretto. Il proxy Cloudflare deve essere nello stato desiderato. Il certificato TLS deve essere valido.

Docker Compose vede solo una parte di questa storia. Terraform può gestire la parte DNS, per esempio record Cloudflare come `api`, `mcp` o altri sottodomini Mercury.

Un esempio concettuale:

```hcl
resource "cloudflare_dns_record" "mcp" {
  zone_id = var.cloudflare_zone_id
  name    = "mcp"
  content = var.vps_ipv4
  type    = "A"
  proxied = true
}
```

Questo non sostituisce Traefik. Traefik continua a decidere come instradare il traffico dentro il VPS. Ma Terraform garantisce che il livello DNS sia dichiarato e verificabile.

Il DevOps specialist può quindi ragionare su tutta la catena:

```text
DNS Cloudflare -> Traefik -> Docker network -> mmd-mcp-server -> healthcheck -> Prometheus/Grafana
```

Se l’MCP endpoint non risponde, l’agente non si limita a dire “container down”. Può controllare ogni livello della catena.

## Bucket backup R2

Il backup service di `market-data` usa credenziali compatibili S3/R2. Questo è uno dei candidati migliori per Terraform, perché il bucket è infrastruttura esterna e non appartiene al runtime Compose.

Terraform potrebbe dichiarare:

- nome del bucket;
- account Cloudflare;
- policy di retention;
- lifecycle rule;
- eventuali credenziali o access policy;
- separazione fra bucket produzione e staging.

Il punto non è solo creare il bucket. Il punto è poter verificare nel tempo che il bucket giusto esista e che le policy siano quelle attese.

Un backup è affidabile solo se è verificabile. Terraform può dire che l’infrastruttura del backup esiste; Prometheus/Grafana o uno script di restore test devono dire se i backup stanno davvero arrivando e sono recuperabili.

## Staging e produzione

Terraform diventa ancora più utile quando si introduce staging. In un sistema senza IaC, staging viene spesso creato copiando comandi dalla produzione e cambiando qualche nome a mano. Questo è un modo classico per creare contaminazioni.

Per `market-data`, staging e produzione non dovrebbero condividere volumi, bucket o credenziali pericolose. Terraform permette di parametrizzare l’ambiente:

```hcl
variable "environment" {
  type = string
}

locals {
  prefix = "mercury-${var.environment}"
}
```

Da qui puoi derivare nomi diversi per reti, bucket e record. Questo non risolve tutto, ma rende più difficile sbagliare ambiente senza accorgersene.

Un DevOps specialist dovrebbe sempre sapere in quale ambiente sta operando. Terraform output e state separati aiutano a rendere questa informazione esplicita.

## Output leggibili dal DevOps specialist

Terraform non deve solo creare risorse. Può anche produrre output leggibili. Questo è molto utile per agenti e console operative.

Un modulo `market-data-prereqs` potrebbe esporre un output come:

```hcl
output "market_data_contract" {
  value = {
    networks = [
      "mmd-network",
      "mercury_dev_network",
      "mercury_platform"
    ]

    volumes = [
      "mercury_timescaledb_data",
      "mercury_tick_state",
      "mercury_questdb_data"
    ]

    backup_bucket = cloudflare_r2_bucket.market_data_backups.name
    api_url       = "https://api.mercuryintelligence.net"
    mcp_url       = "https://mcp.mercuryintelligence.net"
  }
}
```

Il DevOps specialist può leggere questi output e usarli come contratto operativo. La pagina DevOps potrebbe mostrarli come “risorse attese” o “ambiente corrente”.


## Come si inserisce nel repo `infra`

Il repo `infra` ha una natura diversa da `market-data`. Se `market-data` è un servizio applicativo con un proprio runtime, `infra` è già il centro operativo della piattaforma Mercury. Dentro `infra` vivono Traefik, Prometheus, Grafana, Loki, Promtail, Alertmanager, exporter, cAdvisor, configurazioni di routing, configurazioni di monitoraggio, reti condivise e documentazione di deploy del VPS. Per questo motivo Terraform si inserisce in `infra` in modo più diretto e più naturale.

In `market-data`, Terraform dovrebbe restare intorno al servizio. In `infra`, invece, Terraform può diventare parte della forma ufficiale della piattaforma. Non perché debba sostituire `docker-compose.yml`, ma perché molte responsabilità di `infra` sono già responsabilità infrastrutturali: DNS, Cloudflare, prerequisiti VPS, reti comuni, bucket, esposizione pubblica, osservabilità e stato condiviso fra più stack.

La regola resta la stessa: Compose continua a descrivere i container che girano sul VPS. Terraform descrive ciò che deve esistere perché quella piattaforma abbia senso e sia ricostruibile.

### DNS e Cloudflare

Il primo punto in cui Terraform si inserisce bene in `infra` è Cloudflare. Nel deploy guide di Mercury sono documentati i record del dominio `mercuryintelligence.net`: root, `www`, `api`, `mcp`, `monitor`, `traefik`, `portainer` e altri sottodomini possibili. Oggi questo sapere vive nella documentazione e nella configurazione reale di Cloudflare. Funziona, ma richiede che l’operatore ricordi che Cloudflare è la fonte effettiva dei record.

Terraform può trasformare questi record in codice. Questo significa che il dominio pubblico della piattaforma diventa verificabile. Se un record punta a un vecchio IP, se il proxy Cloudflare è disattivato quando dovrebbe essere attivo, se manca un sottodominio, `terraform plan` lo mostra. Non devi scoprirlo perché un endpoint non risponde.

Un frammento concettuale sarebbe:

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

Il valore operativo non è scrivere meno click nella UI. Il valore è poter chiedere, in ogni momento: “il DNS reale coincide con quello dichiarato?”. Per un DevOps specialist questa è una fonte di verità molto più forte di una nota manuale.

### Il confine con Traefik

Terraform non dovrebbe sostituire Traefik. Traefik è il reverse proxy runtime: legge configurazioni, riceve traffico, termina TLS, instrada verso container e network Docker. Terraform può però gestire il livello sopra Traefik: DNS, eventuali regole Cloudflare, e forse alcuni prerequisiti del certificato come il token DNS-01 o le zone attese.

Il confine operativo dovrebbe essere questo:

```text
Terraform  -> record DNS, Cloudflare, prerequisiti esterni
Traefik    -> routing HTTP/TLS dentro il VPS
Compose    -> container Traefik e servizi collegati
Prometheus -> metriche Traefik e salute runtime
```

Se `api.mercuryintelligence.net` non funziona, il DevOps specialist dovrebbe poter camminare lungo la catena. Prima controlla Terraform/Cloudflare: il record esiste e punta al VPS? Poi Traefik: la route esiste e il certificato è sano? Poi Docker: il servizio target è sulla rete giusta? Poi Prometheus/Grafana: il servizio risponde e non genera errori?

Questo è il motivo per cui `infra` è il posto giusto per centralizzare Terraform. Il problema non è solo di un repo applicativo; è della piattaforma che collega tutti i repo.

### Reti Docker condivise

`infra/docker-compose.yml` partecipa a più reti: `mercury_dev_network`, `mmd-network`, `treasury-network`, `website-network` e la rete `mercury_platform`. Queste reti sono il tessuto connettivo fra stack diversi. `market-data` entra in `mmd-network`, `darth-feedor` usa `mercury_dev_network`, il sito usa `website-network`, Traefik deve poter raggiungere più mondi.

Oggi il Makefile di `infra` crea reti con comandi Docker. Questo è pragmatico e funziona. Ma a livello di piattaforma queste reti sono abbastanza importanti da meritare una dichiarazione Terraform o almeno un preflight Terraform. Se una rete manca, non è un dettaglio locale: rompe il routing cross-stack. Se una rete viene rinominata, un servizio può diventare invisibile a Traefik o agli exporter.

Terraform in `infra` potrebbe dichiarare le reti condivise, oppure potrebbe almeno essere usato per verificare che il set delle reti piattaforma sia quello atteso. Nel tempo, la cosa più pulita è che `infra` diventi owner di queste reti. I repo applicativi le consumano come `external: true`, ma non le creano. Questo evita che ogni repo abbia il proprio `make networks` con interpretazioni leggermente diverse.

### Volumi della piattaforma

`infra` ha volumi persistenti propri: dati Prometheus, dati Grafana, ACME storage di Traefik, log Traefik, dati Loki, dati Alertmanager. Anche qui Terraform può essere utile, ma con la stessa cautela vista per `market-data`: i volumi persistenti non devono essere distrutti automaticamente.

Il caso più delicato è `traefik_acme`, perché contiene materiale legato ai certificati. Anche Prometheus e Grafana sono importanti: perdere Prometheus significa perdere storico metriche; perdere Grafana significa perdere stato o configurazioni se non sono interamente provisioned. Loki conserva log; Alertmanager può avere stato operativo.

Terraform potrebbe dichiarare questi volumi con `prevent_destroy`, rendendoli parte del contratto della piattaforma. Il DevOps specialist, leggendo il piano, dovrebbe bloccare immediatamente qualunque cambiamento distruttivo su questi volumi.

### Osservabilità come risorsa di piattaforma

`infra` contiene Prometheus, Grafana, Loki, Promtail, Alertmanager, exporter Postgres, Redis exporter, node-exporter e cAdvisor. Questo significa che `infra` non è solo un repo di deploy; è il sistema nervoso della piattaforma. Qui Terraform può avere due ruoli diversi.

Il primo ruolo è gestire prerequisiti esterni e stato di piattaforma, come DNS, bucket e reti. Questo è il ruolo da adottare subito.

Il secondo ruolo, più maturo, è gestire parte dell’osservabilità come codice: datasource Grafana, dashboard, alert rule, forse contact point e folder. Questo è possibile con provider Grafana, ma va introdotto con calma. Se oggi dashboard e alert vengono modificati manualmente nella UI, mettere Terraform sopra senza strategia può creare conflitto: Terraform potrebbe sovrascrivere modifiche manuali o mostrare drift continuo.

La sequenza sana è: prima rendere Grafana leggibile dal DevOps specialist via Grafana MCP in read-only. Poi identificare quali dashboard e alert sono canonici. Solo dopo valutare “Grafana as code” con Terraform. Non partire gestendo tutto Grafana in Terraform se la pratica operativa non è ancora stabile.

### Bucket, backup e disaster recovery

`infra` è anche il posto giusto per dichiarare risorse di backup condivise. Se `market-data` usa R2 per backup, se altri repo avranno bucket propri, se servono policy di retention o lifecycle, è meglio che la visione complessiva viva in `infra`. Un modulo Terraform `r2-backups` può dichiarare bucket per servizio e ambiente, produrre output e diventare input per i runbook.

La parte importante è non confondere “bucket esiste” con “backup funziona”. Terraform può dichiarare e verificare il bucket. Prometheus, health-report o un restore test devono verificare che i backup arrivino e siano ripristinabili. Il DevOps specialist deve vedere entrambe le cose: contratto infrastrutturale e prova runtime.

### VPS bootstrap e prerequisiti host

`infra/DEPLOY.md` contiene molti passaggi di bootstrap: installazione Docker, strumenti base, UFW, Cloudflare, nomi dominio, directory, clone repo, tmux, chiavi SSH. Non tutto questo deve entrare subito in Terraform. Alcune cose sono più adatte ad Ansible o a script idempotenti. Però Terraform può comunque gestire il livello provider, se il VPS provider espone API: server, firewall cloud, DNS, IP, volumi block storage, eventuali snapshot.

Per il VPS attuale, il primo passo non è necessariamente “Terraform crea il server”. Il primo passo più realistico è “Terraform descrive ciò che intorno al server deve esistere”. In futuro, se si vuole poter ricreare Mercury su un VPS nuovo, allora Terraform può salire di livello e gestire anche provisioning del server e risorse cloud.

### Il ruolo di `infra` come fonte di verità cross-repo

La conseguenza architetturale è che `infra` dovrebbe diventare la fonte di verità per i prerequisiti condivisi. I repo applicativi, come `market-data`, dovrebbero dichiarare nel loro README o in un piccolo file contratto quali prerequisiti consumano. Ma la creazione e la verifica delle risorse condivise dovrebbe vivere in `infra`.

Una struttura possibile è:

```text
infra/terraform/
  modules/
    cloudflare-dns/
    docker-networks/
    platform-volumes/
    r2-backups/
    grafana-foundation/
  envs/
    prod/
    staging/
```

In questa struttura, `market-data` non si porta dietro tutto Terraform. Dice semplicemente: “io dipendo da `mmd-network`, `mercury_timescaledb_data`, `mercury_questdb_data`, bucket backup X, endpoint MCP Y”. `infra` è il luogo che assicura che queste cose esistano e siano coerenti.

### Preflight DevOps per `infra`

Il preflight di `infra` è più ampio del preflight di un repo applicativo. Prima di deployare modifiche a `infra`, il DevOps specialist dovrebbe controllare il piano Terraform, ma anche lo stato della piattaforma esistente. Un deploy di `infra` può toccare Traefik, Prometheus, Grafana o Alertmanager: se qualcosa va storto, perdi osservabilità o routing per più servizi.

Un buon preflight dovrebbe dire:

```text
- DNS Cloudflare allineato
- reti Docker condivise presenti
- volumi Traefik/Prometheus/Grafana/Loki protetti
- nessuna risorsa persistente in destroy
- Prometheus healthy prima del deploy
- Grafana reachable prima del deploy
- Alertmanager healthy prima del deploy
- Traefik route principali sane prima del deploy
```

Dopo il deploy, lo specialista deve verificare gli stessi segnali. Se aggiorni Traefik, controlli certificati, route e metriche. Se aggiorni Prometheus, controlli target e regole. Se aggiorni Grafana, controlli datasource e dashboard. Se aggiorni Alertmanager, controlli che gli alert vengano ancora consegnati.

### Primo MVP Terraform per `infra`

Il primo MVP per `infra` dovrebbe essere piccolo e non distruttivo. Io partirei da tre moduli: Cloudflare DNS, reti Docker condivise, bucket backup. Subito dopo aggiungerei volumi piattaforma con `prevent_destroy`. Solo più avanti guarderei Grafana provider o provisioning VPS completo.

L’obiettivo del primo MVP non è fare “automazione totale”. È ottenere un comando che dica se la piattaforma esterna è allineata:

```bash
cd infra/terraform/envs/prod
terraform plan
```

Se il piano è vuoto, il terreno è coerente. Se il piano mostra drift, il DevOps specialist lo spiega. Se il piano propone distruzioni, il deploy si blocca.

Questa è la forma corretta di adozione: Terraform entra prima come specchio e contratto, poi come strumento di mutazione controllata.

## Dove mettere Terraform

Ci sono due possibilità.

La prima è mettere un piccolo modulo dentro ogni repo applicativo:

```text
market-data/infra/terraform/prereqs/
```

Questo rende il contratto vicino al servizio, ma rischia duplicazione se molte risorse sono condivise.

La seconda, probabilmente migliore per Mercury, è centralizzare in `mercury/infra`:

```text
infra/terraform/
  modules/
    market-data-prereqs/
    cloudflare-dns/
    r2-backups/
    docker-prereqs/
  envs/
    prod/
    staging/
```

Questa struttura riflette meglio il fatto che DNS, reti, bucket e osservabilità sono cross-stack. `market-data` può comunque avere un file di contratto o documentazione che punta al modulo centrale.

## Cosa non mettere nel primo MVP

Il primo MVP non dovrebbe gestire tutto. Non metterei in Terraform:

```text
- container applicativi
- migrazioni Alembic
- feed Python
- API FastAPI
- MCP server
- logica di backup runtime
- comandi docker compose
- dashboard Grafana mutabili, almeno all’inizio
```

Terraform deve partire piccolo e sicuro. Prima DNS, bucket, reti, volumi protetti e output. Poi, se il flusso funziona, si può valutare Grafana provider, alert as code, staging completo o provisioning VPS.

## Il ruolo del DevOps specialist

Il DevOps specialist dovrebbe usare Terraform come strumento di lettura, verifica e spiegazione. Non come licenza per fare mutazioni infrastrutturali automatiche.

Prima di un deploy, dovrebbe eseguire:

```bash
terraform fmt -check
terraform validate
terraform plan
```

Poi dovrebbe tradurre il piano in una sintesi operativa:

```text
Preflight Terraform:
- nessun DNS drift
- bucket backup presente
- reti Docker presenti
- volumi persistenti presenti e protetti
- nessuna risorsa verrà distrutta
Rischio: basso
```

Oppure:

```text
Preflight Terraform:
- il piano propone di sostituire mercury_timescaledb_data
- questa risorsa contiene dati persistenti
- deploy bloccato
Rischio: critico
```

Questo è uno dei casi in cui un agente può essere davvero utile: non perché clicca apply, ma perché legge un piano complesso e lo mette in relazione con il rischio operativo.

## Regole di sicurezza

Per Mercury, le prime regole dovrebbero essere rigide. `terraform destroy` non deve essere disponibile agli agenti. `terraform apply` non dovrebbe essere automatico. Lo state non deve essere sincronizzato casualmente via Syncthing. Produzione e staging devono avere state separati. Le risorse persistenti devono avere protezioni anti-destroy. I segreti non devono finire in `.tfvars` committati.

In particolare, data la presenza di Syncthing tra VPS e macchine locali, lo state Terraform va trattato con estrema cautela. Lo state contiene mapping reali e talvolta valori sensibili. Non è un file da far rimbalzare senza lock fra tre macchine. Per produzione serve o un backend remoto con locking, o una regola molto chiara: solo un ambiente applica, gli altri leggono o generano plan controllati.

## Il primo passo concreto

Il primo passo pragmatico non è “adottiamo Terraform ovunque”. È creare un piccolo proof of concept che non tocchi dati critici.

Un buon candidato sarebbe:

```text
infra/terraform/envs/prod/market-data-prereqs
```

con dentro:

```text
- record DNS Cloudflare rilevanti
- bucket R2 backup market-data
- reti Docker richieste
- volumi dichiarati con prevent_destroy
- output per endpoint e risorse attese
```

Il primo comando operativo non dovrebbe essere `terraform apply`, ma:

```bash
terraform plan
```

L’obiettivo del POC è vedere se il piano descrive correttamente la realtà. Se il piano mostra tanto drift inatteso, hai già imparato qualcosa: la realtà infrastrutturale non è ancora codificata.

## Esempio di manuale operativo futuro

Un giorno, il manuale di deploy di `market-data` potrebbe dire:

```text
Prima di deployare, eseguire il preflight DevOps.

Il preflight controlla:
1. stato Git del repo;
2. test e typecheck minimi;
3. Terraform plan dei prerequisiti;
4. salute Prometheus/Grafana prima del deploy;
5. ultimo backup;
6. volumi e reti critiche;
7. readiness di TimescaleDB e QuestDB.

Se il preflight passa, il deployment specialist può eseguire make spdeploy.
Dopo il deploy, il DevOps specialist confronta metriche pre/post e registra l’esito.
```

Questo è molto diverso dal semplice “fai docker compose up”. È un modo per rendere ogni deploy osservabile, spiegabile e reversibile.

## Conclusione

Per `market-data`, Terraform non è il sistema che fa girare market-data. È il sistema che rende esplicito e verificabile il terreno su cui market-data gira.

Docker Compose resta il runtime. Terraform diventa il contratto infrastrutturale. Prometheus e Grafana diventano gli occhi. Il DevOps specialist diventa il coordinatore che legge il contratto, guarda la realtà, valuta il rischio e decide se il deploy è sicuro.

Questa è la forma più sana: non sostituire strumenti maturi, ma dare a ciascuno un ruolo preciso.
