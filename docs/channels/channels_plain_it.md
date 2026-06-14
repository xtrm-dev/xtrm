---
title: channels - spiegazione semplice
created: 2026-06-12
updated: 2026-06-12
---
# Channels spiegato semplice

> Questa pagina spiega `channels.md` in italiano semplice.
> Non sostituisce la specifica tecnica: serve a capire il progetto, discuterlo e orientarsi.

## 1. In una frase

Un **channel** è uno spazio ordinato dove agenti, giudici e operatori si scambiano messaggi brevi e strutturati, così un lavoro può avanzare senza che una persona debba ogni volta copiare risultati da un agente all'altro.

In pratica: invece di avere mille conversazioni scollegate, ogni container di lavoro ha il suo canale interno, con regole chiare su chi può leggere, chi può agire, chi può svegliare chi, e cosa viene registrato per audit.

## 2. Perché serve

Oggi molti passaggi sono mediati manualmente:

- un reviewer trova un problema, ma l'executor lo vede solo se qualcuno lo sveglia;
- il coordinator spesso fa da postino invece che da giudice;
- l'operatore può mandare istruzioni a un job, ma non a un contesto di lavoro intero;
- la memoria del node conserva conclusioni, ma non conserva bene ordine, destinatari, autorizzazioni e causalità.

`channels` risolve questo creando una primitiva unica: un canale per la comunicazione dentro un container.

```mermaid
flowchart TD
    A["Prima: comunicazione manuale"] --> B["Reviewer legge result.txt"]
    B --> C["Operatore/orchestrator deve svegliare executor"]
    C --> D["Executor corregge"]
    D --> E["Reviewer rilegge"]
    E --> F["Loop fragile e manuale"]

    G["Dopo: channel del container"] --> H["Reviewer posta verdict/finding"]
    H --> I["Channel registra messaggio ordinato"]
    I --> J["Scheduler sveglia il destinatario giusto"]
    J --> K["Executor corregge e posta nuovo turno"]
    K --> L["Judge/coordinator decide continua/done/redirect"]

    style A fill:#f9d6d5,stroke:#8a2b2b
    style G fill:#d7ead9,stroke:#2d6a36
```

## 3. Le parole importanti

| Termine | Significato semplice |
| --- | --- |
| **Container** | Il perimetro di un lavoro: una chain, un node, una pair-talk. |
| **Channel** | Il canale di messaggi dentro quel container. |
| **Participant** | Chi partecipa: executor, reviewer, judge, coordinator, operatore, sistema. |
| **Message** | Un messaggio breve, strutturato, con tipo e destinatari. |
| **Subscription** | La regola che dice quali messaggi un participant riceve automaticamente. |
| **Audience** | Chi può sapere che un messaggio esiste e chi deve agire. |
| **Visibility** | Chi può vedere il pointer/card del messaggio. Non concede potere. |
| **Evidence** | Il contenuto importante e durevole: risultati, verdict, finding, log, prove. |
| **Forensic event** | Traccia di audit: cosa è successo, quando, con quali ID. |
| **Scheduler** | Il componente che decide se e quando svegliare un participant. |
| **Judge** | Un participant speciale che decide `done`, `continue`, `redirect`, e in 0.2 anche `swap`. |

## 4. Il principio più importante

Il channel **consegna messaggi**, ma non decide la verità del sistema.

La separazione è questa:

- **channels**: consegna, ordine, destinatari, messaggi;
- **substrate**: stato autorevole, identità, work graph, proiezioni, grant evidence;
- **forensics**: audit e drilldown, non autorizzazione;
- **metrics**: aggregati a bassa cardinalità, non dettagli per-job.

```mermaid
flowchart LR
    subgraph C["Channel"]
        C1["Messaggi ordinati"]
        C2["Destinatari"]
        C3["Read / ack"]
        C4["Wake intents"]
    end

    subgraph S["Substrate"]
        S1["Identità participant_id/job_id"]
        S2["Work graph"]
        S3["Progress projection"]
        S4["Evidence grant DB"]
        S5["Worktree lease"]
    end

    subgraph F["Forensics"]
        F1["Eventi audit"]
        F2["Lineage"]
        F3["Drilldown"]
    end

    subgraph M["Metrics"]
        M1["Contatori aggregati"]
        M2["Label bounded"]
    end

    C -->|"chiede validazione"| S
    C -->|"scrive audit"| F
    S -->|"espone stato derivato"| C
    F -->|"puo alimentare proiezioni"| M

    C -. "non concede authority da solo" .-> S
    F -. "non e fonte di authority" .-> S
```

## 5. Cosa contiene un channel

Un channel ha tre cose principali:

1. una riga `channels`, che descrive il canale;
2. tante righe `channel_messages`, una per messaggio;
3. una riga `channel_subscriptions` per ogni participant, che dice fino a quale messaggio ha processato.

Il punto delicato: ci sono due numeri.

- `id`: numero globale del messaggio nella tabella. È il **vero cursore** per read/ack/replay.
- `seq`: numero leggibile dentro quel channel. Serve a `sp tail`, non alla correttezza.

```mermaid
erDiagram
    channels ||--o{ channel_messages : contains
    channels ||--o{ channel_subscriptions : has

    channels {
        text id "chain:abc / node:xyz / pair:uuid"
        text kind "pair | chain | node"
        text topology "turns | reactive | freeform"
        text status "open | draining | closed | aborted"
        int next_seq "solo display"
    }

    channel_messages {
        int id "cursore vero"
        int seq "numero display nel channel"
        text channel_id
        text author_key "participant_id"
        text author_job_id
        text kind "work.verdict, control.steer..."
        json audience_json
        json body_json
        json evidence_refs_json
        json forensic_event_ids_json
    }

    channel_subscriptions {
        text channel_id
        text participant_key "participant_id"
        int last_seen_id "ultimo id processato"
        bool paused
    }
```

## 6. Vita di un channel

Un channel nasce, si apre, poi quando il lavoro è finito entra in drain e infine si chiude.

`draining` significa: il canale non accetta più nuovi messaggi azionabili, ma lascia leggere e confermare i messaggi rimasti.

```mermaid
stateDiagram-v2
    [*] --> created
    created --> open: runtime apre il channel
    open --> open: messaggi normali
    open --> draining: system.done o stop condition
    open --> aborted: errore / stop anomalo
    draining --> draining: participant leggono messaggi rimasti
    draining --> closed: tutti hanno drenato o scade grace period
    aborted --> [*]
    closed --> [*]

    note right of open
      Accetta messaggi.
      Scheduler puo svegliare participant.
    end note

    note right of draining
      Niente nuovi messaggi azionabili.
      Si completa solo la consegna.
    end note
```

## 7. Tipi di messaggi

I messaggi non sono testo libero. Ogni messaggio ha una famiglia e una forma precisa.

| Famiglia | Esempi | A cosa serve |
| --- | --- | --- |
| `work.*` | `work.turn`, `work.finding`, `work.verdict`, `work.proposal` | Lavoro reale e risultati. |
| `control.*` | `control.steer`, `control.attention_requested`, `control.escalation` | Istruzioni, richieste di attenzione, escalation. |
| `system.*` | `system.done`, `system.redirect`, `system.swap`, `system.epoch_bump` | Decisioni del runtime/judge. |
| `runtime.*` | `runtime.message_rejected`, `runtime.delivery_failed`, `runtime.participant_died`, `runtime.gate_unresponsive`, `runtime.worktree_diverged`, `runtime.evidence_ref_broken`, `runtime.pulse_delivery_failed`, `runtime.budget_exhausted_mid_step`, `runtime.recursion_cap` | Meccanica e errori del channel + failure meccanici intra-run osservati dal reducer (vedi nota sotto). |
| `chain.incident.*` | `chain.incident.opened`, `chain.incident.resolved` | Wake esplicito del chain coordinator quando recovery deterministica del reducer esaurisce o la failure è judgment-shaped (substrate §4.3 ruolo 5). |
| `note` | testo innocuo | Messaggio preservato ma non azionabile. |

> **Failure meccanici intra-run (added 2026-06-13, xtrm-1jp).** Il reducer osserva continuamente lo stato meccanico del container e registra ogni anomalia come messaggio `runtime.*`:
> - `runtime.participant_died` — un participant non ha emesso `agent_end` entro il budget dello step.
> - `runtime.gate_unresponsive` — un gate è stato dispatched ma non ha emesso `verdict` entro T.
> - `runtime.worktree_diverged` — la base del worktree è stata spostata; il branch non è più fast-forwardabile.
> - `runtime.evidence_ref_broken` — un file o event referenziato da un evidence pointer non esiste più.
> - `runtime.pulse_delivery_failed` — cross-chain hygiene (§4.3 ruolo 3) ha esaurito i retry per un pulse.
> - `runtime.budget_exhausted_mid_step` — la chain ha superato la wall/dollar budget prima del completamento dello step corrente.
> - `runtime.recursion_cap` — un loop coordinator-restitch ha raggiunto l'hard_cap di §5.10.
>
> Su classi deterministiche il reducer tenta recovery automatica (idempotency-keyed retry, requeue, respawn-via-journal §5.9) prima di coinvolgere il coordinator. Quando recovery esaurisce o la failure è judgment-shaped, l'after-hook emette `chain.incident.opened` con idempotency key — il coordinator vede solo questo wake esplicito, non ogni `runtime.*` notice. La purezza del reducer richiesta da §11 è preservata: detection nel reducer, wake intent nell'after-hook. Il chain non può fallire per runtime fallthrough (substrate §3.1 invariante 2026-06-13): `closed:failed` è sempre un coordinator verdict.

```mermaid
flowchart TD
    M["Nuovo messaggio"] --> V{"Schema valido?"}
    V -- "no" --> R1["validation-reject"]
    R1 --> A1["runtime.message_rejected audit"]
    V -- "si" --> AUTH{"Sender autorizzato?"}
    AUTH -- "no" --> R2["authority-reject"]
    R2 --> A2["runtime.message_rejected audit"]
    AUTH -- "si" --> BODY{"Il body prova a darsi poteri?"}
    BODY -- "si" --> N["downgrade a note"]
    BODY -- "no" --> W["scrivi messaggio richiesto"]
    W --> F["forensic event"]
    W --> E{"Produce evidence?"}
    E -- "si" --> EV["evidence durable"]
    E -- "no" --> P["solo stream/projection"]
    EV --> G["work graph / projection"]
    P --> G
```

## 8. Audience: chi vede e chi agisce

Ogni messaggio ha un `audience_json`.

Contiene:

- `visibility`: chi può sapere che il messaggio esiste;
- `action_targets`: chi deve agire;
- `suggested_watchers`: chi potrebbe essere interessato, ma non viene forzato ad agire;
- `scope_refs`: a quali file, issue, package o contract si riferisce;
- `urgency`: quanto può diventare urgente.

La regola semplice:

**vedere non significa poter agire; poter notare non significa essere autorizzati.**

```mermaid
flowchart LR
    MSG["Messaggio"] --> VIS["visibility"]
    MSG --> ACT["action_targets"]
    MSG --> WATCH["suggested_watchers"]
    MSG --> SCOPE["scope_refs"]

    VIS --> CARD["Progress card visibile"]
    ACT --> WAKE["Possibile wake automatico"]
    WATCH --> AWARE["Awareness, non wake forzato"]
    SCOPE --> OVERLAP["scope-overlap subscriptions"]

    CARD --> REQ{"Vuole dettaglio?"}
    OVERLAP --> REQ
    REQ -- "si" --> GRANT{"requestEvidence autorizzato?"}
    GRANT -- "si" --> FULL["evidence dereference"]
    GRANT -- "no" --> DENY["evidence_forbidden"]
```

## 9. `scope_refs` in parole semplici

`scope_refs` risponde alla domanda: "questo messaggio riguarda anche il mio lavoro?"

In 0.1 sono ammessi:

- `file`: un file o una directory;
- `package`: un package/workspace;
- `contract`: un contratto di lavoro;
- `issue`: un issue.

In 0.2 arriva:

- `symbol`: funzione/classe/simbolo, con supporto GitNexus.

```mermaid
flowchart TD
    A["Messaggio con scope_refs"] --> B{"kind"}
    B --> F["file"]
    B --> P["package"]
    B --> C["contract"]
    B --> I["issue"]
    B --> S["symbol 0.2"]

    F --> F1["match: path esatto"]
    F --> F2["match: directory prefix esplicito src/foo/**"]
    P --> P1["match: id esatto"]
    P --> P2["prefix solo se substrate prova relazione package"]
    C --> C1["match: id esatto"]
    I --> I1["match: id esatto"]
    S --> S1["0.2: match simbolo esatto"]
    S --> S2["0.2: adiacenza grafo GitNexus con profondita limitata"]

    F1 --> O["overlap?"]
    F2 --> O
    P1 --> O
    P2 --> O
    C1 --> O
    I1 --> O
    S1 --> O
    S2 --> O
```

## 10. Read e ack: leggere non sposta il cursore

Il sistema separa lettura e conferma.

1. `readSince` legge messaggi nuovi.
2. Il participant prova a processarli.
3. Solo se gli effetti necessari riescono, `markSeen` avanza il cursore.

Questo evita un bug grave: segnare come letto un messaggio che non ha davvero svegliato nessuno.

```mermaid
sequenceDiagram
    participant P as Participant
    participant C as ChannelClient
    participant S as Scheduler
    participant DB as state.db

    P->>C: readSince(last_seen_id)
    C->>DB: leggi messaggi con id maggiore
    DB-->>C: messaggi nuovi
    C-->>P: lista messaggi

    loop per ogni messaggio
        P->>P: controlla audience/subscription
        alt messaggio richiede azione
            P->>S: emetti resume intent
            S-->>P: intent accettato
        else nessuna azione
            P->>P: nessun effetto
        end
    end

    P->>C: markSeen(highestProcessedId)
    C->>DB: aggiorna last_seen_id
```

## 11. Reducer e after-hook

Ogni ciclo ha due parti:

- **reducer**: ricalcola stato, senza effetti esterni;
- **after-hook**: fa effetti reali, ma con chiavi di idempotenza.

Idempotenza significa: se il sistema ripete il passaggio dopo un crash, non crea due wake, due evidence o due edge uguali.

```mermaid
flowchart TD
    A["Nuovi messaggi"] --> R["Reducer puro"]
    R --> R1["calcola turni"]
    R --> R2["controlla stop conditions"]
    R --> R3["controlla ruoli/subscriptions"]
    R --> H["After-hook"]

    H --> I1{"idempotency key gia vista?"}
    I1 -- "si" --> SKIP["salta effetto gia fatto"]
    I1 -- "no" --> E1["resume intent"]

    H --> I2{"forensic_event_id gia visto?"}
    I2 -- "si" --> SKIP
    I2 -- "no" --> E2["scrivi forensic"]

    H --> I3{"edge unique gia visto?"}
    I3 -- "si" --> SKIP
    I3 -- "no" --> E3["deriva work graph edge"]

    H --> I4{"projection watermark aggiornata?"}
    I4 -- "si" --> SKIP
    I4 -- "no" --> E4["aggiorna progress projection"]
```

## 12. Scheduler: il channel non sveglia direttamente i job

Il channel produce un'intenzione: "questo participant dovrebbe essere svegliato".

Poi decide lo scheduler:

- nelle chain è quasi 1:1, semplice;
- nei node decide `node-supervisor`, per evitare split-brain.

```mermaid
flowchart TD
    M["Messaggio accettato"] --> R["Runner legge channel"]
    R --> INTENT["Resume intent"]

    INTENT --> KIND{"Tipo container"}
    KIND --> CHAIN["chain / pair"]
    KIND --> NODE["node"]

    CHAIN --> CS["scheduler semplice 1:1"]
    CS --> CJ["resume job destinatario"]

    NODE --> NS["node-supervisor"]
    NS --> N1["controlla fase"]
    NS --> N2["controlla lease/worktree"]
    NS --> N3["controlla budget/cooldown"]
    NS --> NJ["resume member se permesso"]

    INTENT -. "mai resume diretto dentro node" .-> NS
```

## 13. Work graph e progress card

Il channel è lo stream operativo. Il substrate crea due superfici derivate:

- **work graph**: spiega relazioni durevoli tra issue e risultati;
- **progress projection**: mostra lo stato compatto del container.

Il messaggio non è la verità finale: è la sorgente da cui si derivano evidence, edge e proiezioni.

```mermaid
flowchart LR
    MSG["channel message"] --> FORENSIC["forensic event"]
    MSG --> EVID{"produce evidence?"}
    EVID -- "verdict/finding" --> EV["evidence durable"]
    EVID -- "no" --> NOEV["nessuna evidence"]

    FORENSIC --> EDGE["work_graph_edge"]
    EV --> EDGE
    MSG --> EDGE

    MSG --> PROJ["container_progress"]
    EDGE --> PROJ
    EV --> PROJ

    PROJ --> CARD["progress card filtrata"]
    PROJ --> FULL["getProgressProjection dettaglio"]

    CARD --> SPEC["specialist vede pointer"]
    FULL --> COORD["coordinator vede vista ricca"]
```

## 14. Evidence: vedere un pointer non basta

Un participant può vedere che esiste una prova, ma non può sempre aprirla.

Per aprire evidence fuori dal proprio step contract serve un grant durevole nel DB substrate.

Forensics registra l'audit, ma non autorizza.

```mermaid
sequenceDiagram
    participant P as Participant
    participant CH as Channel
    participant VAL as Evidence validator
    participant DB as evidence_access_grants
    participant F as Forensics
    participant EV as Evidence store

    P->>CH: requestEvidence(evidence_ref)
    CH->>VAL: valida richiesta
    VAL->>DB: grant attivo per participant_id?
    DB-->>VAL: grant / no grant
    VAL->>VAL: controlla job_id corrente, scope, expiry, revoke

    alt autorizzato
        VAL->>F: audit grant/dereference
        VAL->>EV: leggi evidence
        EV-->>P: evidence completo
    else negato
        VAL->>F: audit deny
        VAL-->>P: evidence_forbidden + request_grant
    end
```

La riga di grant contiene:

- chi riceve il grant (`subject_participant_id`);
- quale activation era corrente (`subject_job_id_at_grant`);
- chi l'ha concesso;
- quale evidence o scope copre;
- quando scade;
- se è stato revocato;
- se è override operatore.

## 15. Attenzione opportunistica

Un participant può notare qualcosa anche se il messaggio non era indirizzato a lui.

Ma può solo chiedere:

- rung 1: "vorrei attenzione / contesto";
- rung 2: "propongo di attivarmi".

Non può auto-autorizzarsi.

```mermaid
flowchart TD
    CARD["Progress card"] --> NOTICE{"Participant nota segnale rilevante?"}
    NOTICE -- "no" --> SILENT["resta silenzioso"]
    NOTICE -- "si" --> POLICY{"attention_policy permette?"}
    POLICY -- "no" --> SILENT
    POLICY -- "si" --> KIND{"Tipo segnale"}

    KIND --> R1["Rung 1: control.attention_requested"]
    KIND --> R2["Rung 2: work.proposal self_activation"]

    R1 --> J["coordinator / judge valuta"]
    R2 --> J

    J --> DEC{"decisione"}
    DEC -- "ignora/backoff" --> STOP["nessuna activation"]
    DEC -- "serve contesto" --> GRANT["requestEvidence grant"]
    DEC -- "deve agire" --> REDIR["system.redirect"]
    REDIR --> SCHED["scheduler intent"]
    SCHED --> WAKE["participant svegliato"]
```

Limiti iniziali:

- massimo 2 richieste di attenzione per epoch;
- massimo 1 proposta di self-activation per epoch;
- cooldown iniziale: 2 event ticks / 1 turn;
- stesso scope nello stesso epoch viene deduplicato.

## 16. Epoch

Un epoch è il periodo in cui membership e capability del channel restano uguali.

Si resetta quando il runtime scrive `system.epoch_bump`, per esempio:

- dopo uno swap completato;
- dopo revoca di capability;
- dopo cambio di authority equivalente.

Non è un timer. Non passa "ogni 10 minuti". È legato a cambiamenti reali nello stato.

```mermaid
stateDiagram-v2
    [*] --> Epoch_1: channel open
    Epoch_1 --> Epoch_1: messaggi normali
    Epoch_1 --> Bump: swap/revoca capability
    Bump --> Reload: system.epoch_bump
    Reload --> Epoch_2: participant ricaricano ruoli
    Epoch_2 --> Epoch_2: nuovi budget attenzione

    note right of Reload
      Ogni receiver deve fare
      reloadParticipantRoles
      prima di mutare stato.
    end note
```

## 17. Swap: sostituire un participant senza uccidere il job

`system.swap` non è un kill.

Vuol dire:

1. fermare nuovi resume verso il participant uscente;
2. aspettare che il job esca o diventi `waiting`;
3. gestire il worktree lease;
4. registrare il participant entrante;
5. solo dopo scrivere `system.epoch_bump`.

```mermaid
stateDiagram-v2
    [*] --> active
    active --> swap_requested: judge richiede system.swap
    swap_requested --> outgoing_paused: scheduler valida e pausa subscription

    outgoing_paused --> no_lease: outgoing non ha writer lease
    no_lease --> incoming_registered

    outgoing_paused --> has_lease: outgoing ha writer lease
    has_lease --> waiting_barrier: attende waiting/done
    waiting_barrier --> clean: worktree clean
    clean --> lease_released
    lease_released --> incoming_registered

    waiting_barrier --> dirty: worktree dirty
    dirty --> swap_blocked_dirty: lease resta all'outgoing
    swap_blocked_dirty --> operator_stop: se non yielda, solo sp stop operatore
    operator_stop --> preserve_dirty: modifiche preservate
    preserve_dirty --> explicit_action: checkpoint / commit / stash / takeover-dirty
    explicit_action --> incoming_registered

    incoming_registered --> epoch_bump: system.epoch_bump
    epoch_bump --> [*]
```

## 18. Fasi di implementazione

Il modulo è un unico design, ma si attiva in due tempi.

### 0.1

Serve a far funzionare bene le chain autonome:

- executor e reviewer si parlano via channel;
- il reviewer sveglia l'executor senza intervento umano;
- il judge readonly può chiudere o redirectare;
- evidence, forensics, work graph e progress card funzionano;
- lo scheduler indirection esiste già, anche se semplice.

### 0.2

Attiva le parti più dinamiche:

- node self-managed;
- topology `freeform`;
- active judge con `swap`;
- `node-supervisor` come scheduler reale;
- `node_memory` derivata;
- consensus multi-author;
- attention/self-activation loop attivo.

```mermaid
flowchart TD
    subgraph P01["0.1 - chain autonome"]
        A1["channel storage"]
        A2["post/readSince/markSeen"]
        A3["reactive / turns"]
        A4["readonly judge"]
        A5["work graph edges"]
        A6["progress card"]
        A7["forensic dual-write"]
        A8["scheduler intent"]
    end

    subgraph SEAMS["Seams gia costruiti in 0.1"]
        S1["topology dispatch"]
        S2["participant_id addressing"]
        S3["epoch_bump handling"]
        S4["decision_schema estendibile"]
        S5["edge deriver dispatch table"]
        S6["attention policy fields"]
    end

    subgraph P02["0.2 - node self-managed"]
        B1["freeform"]
        B2["node-supervisor scheduler"]
        B3["active judge / swap"]
        B4["node_memory derived view"]
        B5["consensus:N"]
        B6["self-activation loop"]
    end

    P01 --> SEAMS --> P02
```

## 19. Cosa NON è un channel

Un channel non è:

- un bus globale;
- un sostituto del pulse;
- un sistema di authority;
- un contenitore di output lunghi;
- un framework multi-agent copiato da fuori;
- un modo per guardare tutti i container da un punto centrale.

La regola: **un channel appartiene a un container**.

Se serve coordinamento tra container, si usa `pulse`.

```mermaid
flowchart TD
    C1["chain A channel"] -->|intra-container| A["participant chain A"]
    C2["chain B channel"] -->|intra-container| B["participant chain B"]

    C1 -. "NO: watching diretto cross-container" .- C2

    C1 --> P1["pulse emit"]
    P1 --> PM["pulse mesh"]
    PM --> P2["pulse receive"]
    P2 --> C2

    style PM fill:#e7f0ff,stroke:#2457a6
```

## 20. Le decisioni ormai chiuse

| Tema | Decisione |
| --- | --- |
| Granularità | Channel per chain/pair e channel per node sono entrambi validi. |
| Verdict | Un verdict ha un solo target. N target = N verdict. |
| Swap | Swap sostituisce/unsubscribe, non uccide il job. |
| Judge | Output strutturato con `decision_schema`. |
| Evidence grant | Authority in `evidence_access_grants`, forensics solo audit. |
| `scope_refs` | Typed union, 0.1 senza symbol graph, 0.2 con GitNexus. |
| Epoch/cooldown | Epoch = membership/capability epoch; reset su `system.epoch_bump`. |
| `seq` | Rimane solo per display; `id` è il vero cursore. |
| Dirty worktree swap | Blocca swap automatico; operator action esplicita, mai force-kill. |

## 21. Cosa resta aperto o fuori scope

Resta poco da decidere nel design di `channels`:

- cross-channel watching resta fuori scope; il coordinamento tra container passa da `pulse`;
- multi-user identity resta rimandata finché non esiste davvero il multi-user;
- integrazioni esterne tipo Slack/GitHub comments sono fuori scope;
- i numeri fini della 0.2 si tuneranno su run reali.

## 22. Riassunto operativo

Se devi ricordare solo una cosa:

> Un channel è il diario operativo ordinato di un container. Fa arrivare messaggi e sveglia gli attori giusti, ma non concede autorità da solo. Authority, evidence e graph appartengono al substrate; forensics registra cosa è successo; pulse collega container diversi.

