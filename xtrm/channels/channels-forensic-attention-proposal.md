---
created: 2026-06-05T03:30
updated: 2026-06-11T05:13
date_created: Friday, June 5th 2026, 3:30:44 am
date_modified: Saturday, June 6th 2026, 1:43:16 am
---
# Channels, Forensics, Metrics e attenzione del team

> Stato: proposta / bozza di allineamento.
> Data: 2026-06-05.
> Scopo: fissare le decisioni proposte prima di riallineare i documenti
> canonici `channels` e `substrate`.
> **Doc role: proposta storica (non normativa).** Risolte: Q3, Q4, Q5, Q7 (vedi pointer "Risolta" in §5). Ancora aperte: **Q1, Q2, Q6**. Il contratto normativo vive in `channels.md`.

## 1. Domanda da risolvere

`forensic-event-contract` è ormai abbastanza landed da poter essere trattato
come il contratto concreto `xtrm.forensic.v1`. Questo cambia la pressione di
design su `channels`: prima i channels stavano coprendo sia la comunicazione
operativa sia una parte implicita del ruolo di trace/evidence.

La domanda non è solo se verdict, finding, subscription e messaggi emessi debbano
ora funzionare tramite forensic events. La domanda più profonda è se un routing
troppo rigido renda stupido il team di agenti: se un messaggio non è
strettamente indirizzato a un participant, quel participant deve comportarsi come
se il messaggio non esistesse?

Questa proposta separa i due problemi:

- Proposta A: confine tra channels, forensics, metrics ed evidence.
- Proposta B: modello di attenzione non-stupido per routing, awareness e
  rilevanza opportunistica.

## 2. Proposta A: confine forensics, metrics ed evidence

### Decisione A1: channels non sono forensic events

`channels` resta la primitiva operativa di comunicazione.

`xtrm.forensic.v1` non diventa il mezzo con cui gli agenti parlano tra loro.
Diventa il layer canonico di audit e traceability emesso in parallelo ai fatti
importanti di channel e runtime.

Forma breve:

```text
channel_message = delivery operativa
forensic_event  = audit / trace / drilldown console
evidence        = payload semantico durevole per contesto futuro
metrics         = proiezione low-cardinality da state/events
```

### Decisione A2: le scritture importanti su channel emettono forensic events

Ogni mutazione significativa nel dominio `channels` dovrebbe passare attraverso
lo shared forensic envelope writer. Nessun caller dovrebbe costruire a mano il
JSON finale di un forensic event.

Family meccanica `channel` proposta:

| Evento | Quando viene emesso | Note |
|---|---|---|
| `channel.opened` | Il channel viene creato. | Include topology, container/channel id, numero di participant. |
| `channel.message.posted` | Un messaggio viene accettato nello stream. | Fatto meccanico; il body puo contenere kind, audience/target summary, refs. |
| `channel.message.delivered` | Il runtime offre il messaggio a un reader participant. | Opzionale in v0; utile per debugging delivery. |
| `channel.message.consumed` | Il participant processa e ack-a con successo. | Fatto di cursor/audit, non prova di comprensione semantica. |
| `channel.message.rejected` | Il validator rifiuta o downgrada un messaggio. | Sostituisce log error ad hoc. |
| `channel.closed` | Il channel viene chiuso o abortito. | Linka close reason e messaggio terminale. |
> nota_operatore: devono esserci più eventi, ad esempio, member joined, member left (ad esempio crash o close di qualche motivo, replace in un node)

Questi eventi sono meccanici. I messaggi con significato di dominio emettono
anche il loro evento di dominio.

### Decisione A3: i messaggi semantici fanno dual-write in evidence

Un verdict o un finding non è solo un channel message. È tre cose:

1. Un messaggio live operativo per i participant correnti.
2. Un forensic event per traceability e drilldown.
3. Un evidence record per contesto futuro, close, merge e recovery.

Esempio:

```json
{
  "channel_message": {
    "kind": "verdict",
    "channel_id": "chain:7f3a",
    "author_key": "seconder",
    "audience": {
      "visibility": "chain",
      "action_targets": ["executor"],
      "suggested_watchers": ["reviewer"],
      "scope_refs": ["src/foo.ts", "public-api"]
    },
    "body": {
      "verdict": "PARTIAL",
      "summary": "Scope satisfied, ma quality findings bloccano il progresso.",
      "evidence_refs": ["ev_123"],
      "forensic_event_ids": ["fe_456"]
    }
  }
}
```

Il payload semantico completo vive in evidence:

```json
{
  "evidence_kind": "verdict",
  "issue_id": "unitAI-step-seconder",
  "container_id": "chain:7f3a",
  "payload": {
    "verdict": "PARTIAL",
    "scope_verdict": "PASS",
    "quality_verdict": "PARTIAL",
    "findings": [],
    "tested_commands": [],
    "refs": []
  }
}
```

Il forensic event rende il fatto ricostruibile:

```json
{
  "schema_version": "xtrm.forensic.v1",
  "event_family": "review",
  "event_name": "review.verdict.partial",
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "channels",
    "participant_kind": "specialist",
    "participant_role": "seconder"
  },
  "correlation": {
    "container_id": "chain:7f3a",
    "channel_id": "chain:7f3a",
    "participant_id": "chain:7f3a::seconder",
    "job_id": "job_abc",
    "issue_id": "unitAI-step-seconder"
  },
  "body": {
    "gate_kind": "seconder",
    "verdict": "PARTIAL",
    "findings_count": 3,
    "blocking_count": 2,
    "evidence_refs": ["ev_123"]
  },
  "redaction": { "status": "clean" }
}
```

### Decisione A4: mapping message -> forensic -> evidence

Mapping iniziale:

| Channel kind        | Forensic event                                                              | Evidence                                         |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| `turn`              | `turn.summarized` più opzionale `channel.message.posted`                    | Opzionale, di solito solo result/pointer.        |
| `finding`           | `review.finding.created` o `channel.message.posted` finché non è catalogato | Sì quando è citabile o blocca lavoro.            |
| `verdict`           | `review.verdict.pass`, `review.verdict.partial`, `review.verdict.fail`      | Sì.                                              |
| `steer`             | `control.steer.requested` o `channel.message.posted`                        | Di solito no.                                    |
| `proposal`          | `chain.proposal.created` o `channel.message.posted`                         | Opzionale quando cambia shape/stato della chain. |
| `system.redirect`   | `control.redirect.issued` o `channel.message.posted`                        | Opzionale.                                       |
| `system.done`       | `chain.finalized` più `channel.closed`                                      | Sì, close evidence.                              |
| `system.epoch_bump` | `channel.epoch_bumped` o `channel.message.posted`                           | No, meccanico.                                   |
| `error`             | `channel.message.rejected` o `error.validation`                             | No.                                              |

Decisione di catalogo aperta: aggiungere una piccola event family `channel` per
i fatti meccanici, oppure rappresentare la meccanica channel tramite family già
esistenti come `control`, `error` e `chain`. Una family dedicata `channel` è più
pulita perché separa delivery semantics e significato di dominio.

### Decisione A5: metrics sono proiezioni, mai la verità dei channel

Prometheus non legge channel messages come fonte di verità. Le metriche sono
proiezioni low-cardinality da runtime state e forensic events selezionati.

Dimensioni metriche consentite:

- `service_name`
- `service_component`
- `participant_kind`
- `participant_role`
- `state`
- `result`
- `verdict`
- `gate_kind`
- `error_type`
- `pulse_kind`

Vietati come label:

- `channel_id`
- `container_id`
- `chain_id`
- `issue_id`
- `participant_id`
- `job_id`
- `message_id`
- `forensic_event_id`
- `evidence_id`
- raw path, raw diff, raw prompt, raw error text, raw command, raw URL.

Il drilldown da un sintomo metrico verso messaggi, job, diff, PR o evidence
concreti passa da forensic/evidence state, non dalle label Prometheus.

### Decisione A6: channels v0 deve già portare refs

Anche se Channels v0 spedisce solo `channel_messages`, dovrebbe includere questi
campi forward-compatible:

```text
forensic_event_ids?
evidence_refs?
audience_json?
scope_refs?
```

Così v0 può essere il transport più semplice possibile, ma già rispettare il
confine futuro tra forensic ed evidence.

## 3. Proposta B: modello di attenzione non-stupido

### Decisione B1: routing non è cognizione

Il sistema non deve funzionare così:

```text
messaggio non indirizzato a me => il messaggio non esiste
```

Questo renderebbe stupido il team. Un participant dentro una chain deve capire
che appartiene a un gruppo di lavoro e deve avere una percezione compatta di
come quel gruppo sta progredendo.

Separazione migliore:

```text
routing hard    = chi viene svegliato automaticamente
attention soft  = chi può notare, ispezionare, chiedere contesto o proporre coinvolgimento
authority hard  = chi può mutare stato, scrivere, decidere o chiudere
```

Le subscriptions dovrebbero governare wakeup automatici e prompt injection, non
la realtà.

### Decisione B2: usare audience invece di un target assoluto singolo

Sostituire il modello mentale di un singolo `target_key` forzato con una shape
`audience`.

Shape proposta:

```json
{
  "audience": {
    "visibility": "chain",
    "action_targets": ["executor"],
    "suggested_watchers": ["reviewer"],
    "scope_refs": ["src/foo.ts", "public-api"],
    "urgency": "normal"
  }
}
```

Significato:

- `visibility`: chi può sapere che l'evento è accaduto.
- `action_targets`: chi dovrebbe agire e può essere svegliato automaticamente.
- `suggested_watchers`: participant che potrebbero essere interessati, ma non
  devono essere forzati all'azione immediata.
- `scope_refs`: hint strutturati per il relevance matching.
- `urgency`: aiuta a decidere quando l'attenzione soft può diventare escalation
  automatica.

`target_key` può restare come alias compatibile v0 per
`audience.action_targets[0]`, ma il design dovrebbe muoversi verso `audience`.

### Decisione B3: separare ambient awareness, actionable routing e opportunistic attention

Ci sono tre layer.

#### Ambient awareness

Ogni participant in una chain riceve una progress projection compatta. Non è un
transcript e non è un'istruzione. È stato del gruppo di lavoro.

Esempio:

```json
{
  "kind": "progress.pointer",
  "summary": "seconder emitted PARTIAL against executor step",
  "actor": "seconder",
  "action_targets": ["executor"],
  "impact": "chain returns to remediation",
  "refs": {
    "channel_message_id": 123,
    "forensic_event_id": "fe_456",
    "evidence_id": "ev_123"
  }
}
```

#### Actionable routing

Solo i participant matching vengono svegliati automaticamente:

```text
steer:me
verdict:me
system.redirect:me
finding:scope-overlap
proposal:judge
gate.unsatisfied:coordinator
```

Questo layer resta strict perché protegge costi, dimensione del contesto, loop
safety e worktree authority.

#### Opportunistic attention

Un participant può notare che un ambient signal è rilevante per il proprio
mandato e chiedere contesto o proporre coinvolgimento.

Esempio:

```text
Questo verdict non era indirizzato a me, ma cita public-api scope e il mio step
contract possiede downstream API compatibility. Richiedo evidence ev_123 o
chiedo al coordinator se devo fare recheck.
```

Questa è la parte non-stupida. Va permessa, ma bounded.

### Decisione B4: aggiungere attention policy alle participant definitions

Estensione proposta:

```json
{
  "channel": {
    "awareness": ["chain.progress", "system.done", "system.epoch_bump"],
    "subscribes": ["steer:me", "verdict:me", "finding:scope-overlap"],
    "wakes_on": ["steer:me", "verdict.PARTIAL:me", "verdict.FAIL:me"],
    "attention_policy": {
      "can_inspect_progress": true,
      "can_request_evidence": true,
      "can_self_activate_on": [
        "scope-overlap",
        "blocked-next-step",
        "contract-risk",
        "dependency-risk",
        "repeated-failure"
      ],
      "self_activation_requires": "proposal"
    }
  }
}
```

Default per la maggior parte degli specialist:

```json
{
  "awareness": ["chain.progress", "system.done", "system.epoch_bump"],
  "subscribes": ["steer:me", "verdict:me", "system.redirect:me", "finding:scope-overlap"],
  "wakes_on": ["steer:me", "verdict.PARTIAL:me", "verdict.FAIL:me", "system.redirect:me"]
}
```

Default per coordinators:

```json
{
  "awareness": ["chain.progress", "*"],
  "subscribes": ["verdict", "finding", "proposal", "system.idle", "system.budget", "escalation"],
  "wakes_on": ["proposal", "gate.unsatisfied", "system.idle", "system.budget", "escalation"]
}
```

### Decisione B5: chain progress projection come workgroup memory surface

Non far leggere ogni channel message a ogni participant. Mantenere invece una
projection compatta:

```json
{
  "container_id": "chain:7f3a",
  "current_state": "working",
  "current_step_issue_id": "unitAI-x.3",
  "latest_progress": [
    {
      "kind": "verdict",
      "summary": "seconder returned PARTIAL on executor output",
      "actor": "seconder",
      "action_targets": ["executor"],
      "suggested_watchers": ["reviewer"],
      "evidence_ref": "ev_123",
      "forensic_event_id": "fe_456"
    }
  ],
  "blocked_by": ["unitAI-x.2"],
  "next_expected": "executor remediation"
}
```

Questa projection è l'awareness payload di default incluso nel contesto dei
participant. Dà group awareness senza allagare la context window.

### Decisione B6: pointer prima, dereference dopo

I participant non ricevono automaticamente payload completi per messaggi non
actionable. Ricevono pointer.

Il dereference è consentito quando:

- il messaggio è indirizzato al participant;
- la sua subscription matcha;
- il suo step contract lista quella evidence come input;
- il coordinator autorizza o fa redirect;
- la attention policy del participant consente una relevance request;
- un human/operator chiede drilldown.

Questo evita entrambi gli estremi: niente chat firehose, ma nemmeno agenti ciechi.

### Decisione B7: authority resta hard

Soft attention non implica permesso di mutare. Un participant può notare e
chiedere, ma l'autorità resta validata da stato durevole:

- identità e ruolo del participant;
- capability policy;
- worktree lease;
- stato di container/chain;
- issue contract;
- autorizzazione coordinator/runtime.

Il body text che pretende authority resta invalido. Il sistema può essere curioso
senza diventare credulone.

## 4. Invarianti combinate

1. Channels deliver work.
2. Forensics record facts.
3. Evidence preserves meaning.
4. Metrics project low-cardinality aggregates.
5. Progress projection gives group awareness.
6. Subscriptions decide automatic action, not reality.
7. Audience is richer than target.
8. Attention can be soft; authority stays hard.
9. Payload is pointer-first and dereferenced by relevance/authority.
10. Console drilldown reads forensic/evidence, not channel history as primary
    truth.

## 5. Domande aperte per l'allineamento

1. Il catalogo eventi deve aggiungere una family dedicata `channel`, oppure la
   meccanica channel va rappresentata tramite `control`, `error` e `chain`?
2. `audience.visibility` è sempre `chain` per chain channels, oppure servono
   valori più stretti come `targets`, `coordinator`, `private`?
3. La self-activation opportunistica deve creare un messaggio `proposal`, un
   forensic event `control.attention_requested`, o entrambi?

   > **Risolta** — vedi `channels.md` §5.10. Falsa dicotomia: `control.attention_requested` è un *message kind* (famiglia control), non un'alternativa al forensic (che è sempre il gemello di audit). Due pioli, entrambi **richieste mai auto-attivazioni**: rung 1 `control.attention_requested` (soft, "alzo la mano"), rung 2 `work.proposal{self_activation}` (firm, "propongo di agire") — l'attivazione la decide sempre coordinator/judge. Bound bilanciati: 2 attention + 1 self-activation per epoch, cooldown, dedup per scope_ref. Campo canonico `self_activation_mode: off|attention|proposal` (= piolo massimo consentito). Contratto in 0.1 (seam 9), loop attivi in 0.2.
4. Quanta parte della progress projection vive in `channels` e quanta in
   `substrate`? Channels possiede lo stream dei messaggi; substrate probabilmente
   possiede il progresso del container.

   > **Risolta** — vedi `channels-upgrade.md` §23. La projection è di **substrate**, perché è un *join* di stream channel + work-graph edges + stato issue/step + runtime. Channels possiede lo stream; substrate assembla e possiede la projection come cache event-sourced ricomputabile.
5. In v0, `ChannelClient.post()` deve fare subito dual-write forensic events, o
   la prima implementazione deve solo conservare refs nullable e aggiungere lo
   shared writer in v0.5?

   > **Risolta** — vedi `channels.md` §11 (0.1). Sotto delivery unica il dual-write forensic + evidence entra già in 0.1 tramite lo shared envelope writer; `audience_json`, `forensic_event_ids` ed `evidence_refs` sono canonici nello schema 0.1.
6. Qual è la policy esatta per un participant che dereferenzia evidence non
   presente nel suo step contract ma matching per scope-overlap?
7. Per il wakeup e delivery dei messaggi a tutti i partecipanti, il coordinator si occupa del routing? Il payload del progresso della chain viene passato allo specialist che si risveglia in automatico (quindi una sorta di "coda" dei progressi cached = qualunque specialist che si risveglia nella chain, lo riceve)

   > **Risolta** — vedi `channels-upgrade.md` §23. No, non è il coordinator a fare il routing: la projection è computata dall'**after-hook di runtime** (i pair/chain channel in 0.1 non hanno coordinator). Sì alla "coda cached": allo specialist che si sveglia viene *pushata* la card di progresso **visibility-filtered** (pointer-only) nel resume payload; il dettaglio si fa pull on-demand (`getProgressProjection` / `requestEvidence`).

