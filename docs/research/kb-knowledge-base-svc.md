Ricerca sulle knowledge base:

# Service Skills come knowledge system operativo

## Verifica deterministica dell’auto-reconcile e retrieval evidence-first

**Stato della ricerca:** 23 luglio 2026  
**Repository di riferimento:** `mercuryintelligence/infra`  
**Ambito:** service-skills, memoria operativa, issue dispatch, incident routing e verifica della documentazione generata

## Verdetto sintetico

La direzione raccomandata non è sostituire le service skill né costruire una nuova knowledge platform. Occorre mantenere `SKILL.md` come superficie di authoring e revisione umana, aggiungendo due livelli derivati e ricostruibili:

1. un **claim verifier deterministico**, eseguito tra la generazione LLM e qualsiasi write, commit o pull request;
    
2. un **indice locale evidence-first**, costruito da registry, sezioni delle skill, claim verificati, riferimenti sorgente e probe eseguibili.
    

L’LLM può proporre modifiche, decomporre claim e criticare i residui ambigui. Non deve però emettere il verdetto finale, decidere il ranking nel percorso caldo o rendere vera una claim semplicemente perché un secondo modello la approva.

L’unità di authoring rimane la skill completa. L’unità di retrieval principale diventa la sezione contestualizzata. L’unità di verifica, provenance e invalidazione diventa la claim atomica. L’unità operativa diventa il probe eseguibile.

Il sistema oggi indicizzato nella repo contiene 16 servizi, mentre il prompt di ricerca descrive una baseline di 17 skill. Questa divergenza non è rilevante come errore numerico, ma dimostra che conteggi, cataloghi e superfici aggregate devono essere derivati e rigenerabili, mai considerati fonti primarie.

---

# §1 — Stato dell’arte

## 1.1 Verifica fattuale di output generativi

La letteratura sulla factuality offre strumenti utili soprattutto per **decomporre**, **cercare evidenza**, **individuare contraddizioni** e **misurare precisione fattuale**. Non fornisce però una ragione per affidare a un altro LLM la validazione definitiva di configurazioni operative.

Chain-of-Verification, o CoVe, genera una risposta iniziale, formula domande di verifica, risponde alle domande separatamente e produce una versione revisionata. Gli esperimenti riportano una riduzione delle allucinazioni in task a lista, question answering e generazione lunga. La separazione tra generazione e verifica è rilevante per `reconcile.py`, ma la verifica rimane model-based e non dimostra l’esattezza rispetto a una repository concreta.

FActScore propone di decomporre un testo lungo in fatti atomici e misurarne la precisione rispetto a una fonte. Il contributo trasferibile è l’idea che una sezione Markdown non debba ricevere un unico giudizio globale: deve essere spezzata in claim indipendenti, ciascuna con evidenza e verdetto propri.

RARR cerca fonti di attribuzione e modifica le parti non supportate preservando il più possibile il testo originale. È un riferimento utile per una futura modalità di “repair”, nella quale il verifier non rigenera l’intera skill, ma restituisce al reconciler esclusivamente claim contestate ed evidenza contraria. RARR è tuttavia una pipeline di ricerca e revisione basata su LLM e web search, non un verificatore deterministico di configurazioni locali.

SelfCheckGPT misura l’incoerenza fra campioni generati dallo stesso modello senza ricorrere a una knowledge base esterna. È adatto a segnalare contenuti instabili, ma non può distinguere una falsità ripetuta coerentemente da un fatto corretto. Nel sistema proposto può alimentare un indicatore di incertezza, non un gate.

Gli studi sugli LLM-as-judge documentano bias di posizione, verbosità, auto-preferenza e limiti di reasoning. Anche quando l’accordo con preferenze umane supera l’80%, si tratta prevalentemente di valutazioni qualitative e comparative, non di verifica di uguaglianza fra una lista di label documentata e una lista ricavata da codice o YAML.

La conclusione per Matter 1 è netta: CoVe, FActScore, RARR e SelfCheckGPT giustificano una fase di claim decomposition e un critic pass sui residui. Non giustificano un gate deciso da maggioranza di modelli.

## 1.2 Il pattern realmente adottato dai coding agent

I sistemi di coding operativi riducono il blast radius separando generazione, ambiente di lavoro, controlli deterministici e revisione.

Codex esegue i task in ambienti isolati, può avviare test, linter e type checker e presenta log e risultati dei test come evidenza verificabile. La documentazione continua a richiedere revisione umana prima dell’integrazione.

Codex Security applica un pattern ancora più vicino al problema delle service skill: individua una possibile vulnerabilità, tenta di riprodurla in sandbox, mostra solo i risultati convalidati e propone una patch minima sottoposta a revisione. Il principio trasferibile è che una finding generata dal modello non diventa un fatto finché un validatore esterno non ne dimostra l’esistenza.

Aider esegue automaticamente il lint sui file modificati e può eseguire test dopo ciascun cambiamento, tentando quindi di correggere gli errori rilevati dagli strumenti. È una forma semplice ma efficace di “generator outside, verifier inside the loop”.

Cursor ha implementato shadow workspaces separati per applicare modifiche proposte e interrogare il language server senza contaminare il workspace principale. Il parallelismo utile non è “più modelli che votano”, ma “una modifica candidata eseguita e controllata in uno stato isolato”.

GitHub Copilot coding agent esegue test e lint del progetto, quindi strumenti distinti per CodeQL, dipendenze vulnerabili, secret scanning e code review. Le verifiche sono configurabili ma attive per impostazione predefinita. GitHub applica inoltre la stessa validazione di sicurezza al codice prodotto da agenti terzi.

Copilot code review combina esplicitamente tool calling e rilevazioni LLM con strumenti deterministici come CodeQL ed ESLint. Questo è il precedente industriale più direttamente trasferibile: l’LLM trova e spiega, mentre il controllo rule-based mantiene un canale indipendente e ripetibile.

Il pattern comune è quindi:

**candidate in ambiente isolato → strumenti deterministici → eventuale iterazione del modello → evidence report → revisione o merge policy.**

La pipeline corrente delle service skill salta il passaggio centrale. `reconcile.py` costruisce il prompt usando l’intera skill esistente e un singolo file sorgente, accetta la risposta come documento completo e la scrive atomicamente sul path finale. Non esistono claim extraction, confronto con l’intero territorio, verifica delle fonti citate o gate intermedio.

## 1.3 Retrieval e knowledge systems

La lezione più importante dei sistemi recenti non è “usare embeddings”, ma evitare di caricare tutto.

Il lavoro Lost in the Middle mostra che le prestazioni possono degradare sensibilmente quando l’informazione utile è collocata al centro di contesti lunghi. Incrementare il numero di documenti recuperati può aumentare il recall del retriever senza produrre un incremento corrispondente nella qualità del reader. Questo sconsiglia di iniettare sempre una skill completa.

Anthropic Contextual Retrieval combina Contextual BM25 e contextual embeddings per conservare nel chunk informazioni che normalmente andrebbero perse durante la segmentazione. Per le service skill, la conseguenza non è introdurre subito embeddings, ma rendere ogni sezione o claim autosufficiente aggiungendo servizio, territorio, sezione, fonte e stato di verifica.

Sourcegraph Cody ha descritto un retrieval basato su BM25 adattato, segnali di code intelligence, contesto locale e ranking globale dei frammenti. Sourcegraph ha anche rimosso, almeno da quella generazione della propria architettura enterprise, gli embeddings dal percorso principale per ridurre complessità, trasferimento di codice a terzi e costi di manutenzione dell’indice. È un precedente forte a favore di FTS5 e segnali strutturali prima di un vector store.

L’OKF di Google Cloud definisce un formato deliberatamente minimale: Markdown, YAML frontmatter, un solo campo obbligatorio `type`, campi raccomandati quali `title`, `description`, `resource`, `tags` e `timestamp`, estensioni tollerate dai consumer, `index.md` per progressive disclosure e `log.md` per la cronologia. Questo è adatto come envelope interoperabile, non come schema completo delle claim operative.

OpenWiki 0.2 applica OKF alla documentazione di codebase e genera deterministicamente gli indici dalle descrizioni del frontmatter. Si tratta di un progetto OSS spedito, ma la generazione del contenuto rimane agentica; pertanto è un riferimento utile per packaging e progressive disclosure, non per la veridicità delle affermazioni.

Anthropic Memory Tool usa file persistenti controllati dall’applicazione e retrieval just-in-time, evitando di caricare tutto nel contesto. Il paradigma è compatibile con service skill locali: storage posseduto dall’operatore, strumenti stretti e lettura on demand.

Letta distingue memoria sempre in contesto e memoria recuperabile, e nelle implementazioni recenti espone una memoria file-based e versionata tramite Git. Il principio riutilizzabile è la separazione fra nucleo invariabile e conoscenza richiamata su domanda; non è necessario adottare il suo runtime.

LangMem distingue aggiornamenti in hot path e consolidamento in background. La sua API rende inoltre il delete disabilitato per default e conserva version history. Questo pattern è utile per la memoria conversazionale, ma per conoscenza operativa un fatto invalido non può continuare a essere recuperato come se fosse attivo.

Mem0 dichiara nella propria implementazione 2026 un’estrazione ADD-only e retrieval multi-segnale con semantic search, BM25, entity matching e temporal reasoning. I benchmark sono vendor-reported e riferiti alla memoria di agenti, non a runbook operativi. L’ADD-only è adatto all’audit log; non è sufficiente per il current truth di un’infrastruttura.

Graphiti rappresenta fatti con finestre temporali e provenance verso gli episodi sorgente, invalidando i fatti superati senza cancellarne la storia. È un buon modello concettuale per `active`, `superseded` e `invalidated`, ma richiede un graph backend, embeddings e componenti che sarebbero sproporzionati per 16 servizi.

Cerebras descrive in un engineering blog una knowledge base con connettori per fonte, retrieval ibrido, RRF, reranking e context expansion. È un sistema descritto da chi lo ha costruito, non una pubblicazione peer-reviewed; inoltre il corpus e la tolleranza allo stale content sono differenti da quelli di un runbook operativo. Il valore trasferibile è l’uso di tool stretti e di evidence retrieval, non il suo stack completo.

## 1.4 Classificazione delle evidenze

|Riferimento|Stato|Evidenza disponibile|Elemento trasferibile|
|---|---|---|---|
|CoVe, FActScore, RARR, SelfCheckGPT|Ricerca accademica|Benchmark su factuality e attribution|Decomposizione, verifica separata, revisione localizzata|
|LLM-as-judge|Ricerca accademica|Accordo con preferenze umane e bias misurati|Utile come advisory, inadatto come arbitro unico|
|Codex, Cursor, Aider, GitHub Copilot|Sistemi spediti|Workflow documentati, alcuni dati operativi vendor-reported|Sandbox, lint/test, validator esterni, patch minima, review|
|OKF|Specifica draft pubblica|Conformance e schema documentati|Envelope minimale, progressive disclosure, estensibilità|
|OpenWiki|OSS spedito|Implementazione e blog tecnico|Indici generati e documentazione repository-native|
|Anthropic Memory Tool, Letta, LangMem|Sistemi o librerie spedite|Documentazione e implementazioni pubbliche|Retrieval just-in-time, storage controllato, hot/background path|
|Mem0, Graphiti|Sistemi spediti con benchmark vendor-reported|Repository, docs e paper associati|Multi-signal retrieval, provenance temporale|
|Cerebras KB|Engineering blog|Architettura dichiarata dal produttore|Evidence bundle, narrow tools, fusion differita|

---

# §2 — Matter 1: architettura raccomandata per il fact-check

## 2.1 Problema concreto osservato

Una service skill reale contiene numerose claim ad alto rischio verificabili: nomi di container, immagini, network, volumi, environment variable, receiver, route, label, file, comandi e liste apparentemente complete. La skill Alertmanager, per esempio, dichiara quattro variabili sostituite dall’entrypoint, nomina il file renderizzato, descrive route specifiche e fornisce failure mode e probe.

Il reconciler vede invece un solo file drifted per invocazione. Una modifica che coinvolga compose, entrypoint, template e configurazione può quindi essere documentata sulla base di evidenza incompleta anche se tutti i file rilevanti sono contenuti nel territorio registrato.

Il verificatore deve perciò operare sull’insieme:

**candidate diff + current skill + intero territorio registrato + file infrastrutturali esplicitamente collegati + commit base/head.**

Il singolo file che ha attivato il drift è un trigger, non l’intero corpus probatorio.

## 2.2 Flusso proposto

La pipeline deve assumere questa forma:

|Fase|Funzione|Determinismo|
|---|---|---|
|Candidate generation|L’LLM produce una skill candidata in un path temporaneo o worktree|No|
|Structural validation|Frontmatter, headings, semantic blocks, Markdown AST, link syntax|Sì|
|Claim extraction|Estrae esclusivamente claim nuove o modificate dal diff|Prevalentemente sì|
|Evidence collection|Cerca fonti autoritative nel territorio e nei file collegati|Sì|
|Claim verification|Confronta claim normalizzate con evidenza estratta|Sì|
|Residual critique|Secondo modello analizza solo claim non decidibili e relativo evidence pack|No, advisory|
|Gate computation|Calcola il verdetto a partire da regole e risultati deterministici|Sì|
|Publish|Scrive, committa o apre PR in base al gate|Sì|

Il candidate file non deve sostituire `SKILL.md` prima del gate. L’`atomic_write` esistente può essere riutilizzato dopo il verdetto, non prima.

## 2.3 Tassonomia delle claim

|Claim type|Esempi|Verificatore preferito|Limite|
|---|---|---|---|
|`quoted_literal`|path, stringa di redaction, receiver, flag CLI|Ricerca esatta, parser del file sorgente|Non dimostra il significato operativo|
|`environment_constant`|`DISCORD_WEBHOOK_URL_WARNING`|Compose/YAML, AST, shell parser, `.env.example`|Il valore runtime segreto non va letto né indicizzato|
|`symbol_name`|funzione, classe, costante, endpoint|AST o tree-sitter; grep solo come fallback|Dynamic imports e reflection possono risultare ambigui|
|`compose_resource`|service, container, image, network, port, volume|Parser Compose/YAML con merge e override noti|Tag calcolati o override esterni richiedono evidenza runtime|
|`metric_family`|nome metric family|AST dell’instrumentation, exposition fixture, Prometheus rules|Metriche costruite dinamicamente possono non essere enumerabili|
|`metric_label_set`|label ammesse o prodotte|AST, constructor call, registry, test fixture|Label condizionali richiedono cardinalità e path analysis|
|`config_value`|timeout, retention, interval, port|Parser strutturale del formato sorgente|Valori sovrascritti via env o deploy overlay|
|`set_claim`|“le quattro variabili sono…”|Confronto insiemistico e cardinalità|Richiede dichiarazione esplicita di completezza|
|`citation_claim`|“vedi file X”, riferimento a runbook|Esistenza path, anchor, hash e line range|Una citation esistente può non supportare semanticamente la claim|
|`procedure_claim`|comando operativo e sequenza|Shell parse, esistenza binario/script, dry-run o probe|Sicurezza ed efficacia possono dipendere dal runtime|
|`causal_claim`|“questo errore è causato da…”|Test, incident evidence o revisione umana|Generalmente non decidibile con grep|
|`runtime_claim`|servizio attivo, route effettiva, immagine deployata|Probe read-only e snapshot firmato|Non verificabile staticamente|
|`external_claim`|comportamento di Discord, Telegram, API esterna|Documentazione primaria o test controllato|Può cambiare senza commit nella repo|

Regex è adeguata per estrarre backtick, path e marker linguistici. Non deve essere usata come parser principale per YAML, Python, shell o configurazioni strutturate. La priorità è parser nativo, poi AST/tree-sitter, poi ricerca testuale.

## 2.4 Claim complete e claim parziali

La verifica dei membri presenti non basta quando il testo dichiara un insieme completo. Occorre riconoscere i **closure marker**.

Sono marker di completezza:

|Forma|Interpretazione|
|---|---|
|“esattamente N”|cardinalità e uguaglianza dell’insieme|
|“le N variabili sono”|cardinalità e uguaglianza|
|“tutte le label”|uguaglianza dell’insieme|
|“solo”, “unicamente”|assenza di membri ulteriori|
|“la lista completa”|uguaglianza|
|tabella con metadata `complete`|uguaglianza dichiarata|

Sono marker di parzialità:

|Forma|Interpretazione|
|---|---|
|“include”, “tra cui”|verifica solo dei membri citati|
|“ad esempio”, “e.g.”|nessun controllo dei membri mancanti|
|“principali”|parziale|
|“almeno”|sottoinsieme con cardinalità minima|
|nessun marker|default `unknown`, non assumere completezza|

La skill Alertmanager afferma che l’entrypoint sostituisce quattro variabili e mostra esattamente quattro espressioni `sed`. Questa è una claim completa verificabile tramite uguaglianza dell’insieme, non una semplice ricerca dei quattro nomi citati.

Per evitare che il significato dipenda sempre dalla prosa, il manifest derivato dovrebbe consentire:

|Campo|Valori|
|---|---|
|`completeness`|`complete`, `partial`, `unknown`|
|`expected_count`|intero o assente|
|`closure_source`|marker testuale, tabella, annotazione curatoriale|
|`observed_count`|cardinalità estratta dalla fonte|
|`comparison`|equal, subset, superset, unresolved|

## 2.5 Claim manifest

Il manifest non sostituisce il Markdown e non deve essere scritto manualmente per tutte le skill. È un artefatto derivato e ricostruibile.

|Campo|Scopo|
|---|---|
|`schema_version`|Evoluzione compatibile del formato|
|`claim_id`|ID stabile derivato da servizio, sezione e fingerprint semantico|
|`service_id`|Join con `service-registry.json`|
|`skill_path`|Documento di origine|
|`section_path`|Gerarchia headings|
|`claim_text`|Testo verificato|
|`claim_type`|Tassonomia precedente|
|`subject`, `predicate`, `objects`|Forma normalizzata minima|
|`completeness`, `expected_count`|Semantica delle liste|
|`risk`|low, medium, high, critical|
|`authority_required`|Classe minima di fonte|
|`source_refs`|path, line range, commit, content hash|
|`candidate_ref`|Commit o worktree della modifica|
|`verdict`|Stato calcolato|
|`verifier_id`, `verifier_version`|Riproducibilità|
|`verified_at_ref`|Commit contro cui è valido|
|`evidence_digest`|Hash del bundle di evidenza|
|`advisories`|Informazioni non bloccanti|

La forma deve rimanere abbastanza semplice da essere serializzata in JSON e indicizzata in SQLite.

## 2.6 Gerarchia delle fonti

L’authority non deve essere dedotta dal fatto che un contenuto sia scritto in Markdown.

L’ordine raccomandato è:

1. configurazione eseguibile e codice effettivamente deployabile;
    
2. test, fixture di exposition, manifest generati deterministicamente;
    
3. probe read-only contro l’ambiente, quando espressamente consentiti;
    
4. blocchi curatoriale protetti da `SEMANTIC_START/END`;
    
5. claim già verificate e ancora valide allo stesso source ref;
    
6. testo auto-generato non ancora verificato;
    
7. memory item, report, issue e discussioni storiche.
    

Una fonte di livello inferiore può fornire contesto, ma non contraddire silenziosamente una fonte superiore.

Per claim causali o procedurali, il codice può non essere sufficiente. Una failure mode come “400/404 significa webhook non sostituito” deve essere supportata da test, incidente osservato, documentazione primaria o sign-off umano; altrimenti deve essere classificata come `operational_hypothesis`, non come fatto deterministico.

## 2.7 Gate lattice

La proposta iniziale `CONFLICT → no PR`, `INSUFFICIENT_EVIDENCE → advisory PR`, `PASS → auto-merge` è troppo aggressiva nella transizione da una baseline senza verifier.

La lattice raccomandata è:

|Gate|Condizione|Effetto|
|---|---|---|
|`INVALID`|Documento non parseabile, contract rotto, semantic block cancellato, path escape|Nessuna write, nessuna PR|
|`CONFLICT`|Fonte autoritativa contraddice una claim candidata|Nessuna write sul documento canonico; report di conflitto|
|`EVIDENCE_RACE`|HEAD, source hash o territory snapshot è cambiato durante la verifica|Invalidare il run e rieseguire|
|`INSUFFICIENT_EVIDENCE_HIGH_RISK`|Claim high/critical non verificabile|Solo draft PR chiaramente non mergeable, oppure nessuna PR nel flusso locale|
|`PASS_WITH_ADVISORIES`|Tutte le claim bloccanti passano; restano residui low-risk|PR normale, niente auto-merge nella fase iniziale|
|`PASS`|Claim modificate verificate, contract valido, fonti stabili|PR normale; auto-merge solo dopo canary e policy separata|

`PASS` non deve implicare immediatamente auto-merge. L’auto-merge deve essere una seconda decisione basata su risk class, copertura del verifier e metriche storiche.

Nella prima versione, anche `PASS` apre una PR. Dopo un periodo di osservazione, si può abilitare auto-merge esclusivamente per cambiamenti low-risk, ad esempio aggiornamenti di path, simboli o valori esatti già coperti da parser e fixture. Claim causali, comandi distruttivi, security posture e complete set critici devono conservare review umana.

## 2.8 Confronto delle architetture

|Architettura|Precisione|Token|Riproducibilità|Verdetto|
|---|--:|--:|--:|---|
|Secondo LLM inline|Media|Medio|Bassa|Non raccomandato come gate|
|Python deterministico|Alta sulle claim coperte|Zero|Alta|Base obbligatoria|
|Deterministico + critic LLM sui residui|Alta, con migliore copertura|Basso/medio|Verdetto riproducibile|Raccomandato|
|Panel N-way a maggioranza|Incerta per errori correlati|Alto|Bassa|Solo esperimento o analisi offline|

La maggioranza riduce errori indipendenti. Le allucinazioni di modelli istruiti con lo stesso prompt, la stessa evidenza incompleta e pattern di training simili non sono sufficientemente indipendenti. Inoltre il voto non produce una source of truth.

Il critic LLM deve ricevere esclusivamente:

- la claim;
    
- il suo tipo;
    
- il diff rilevante;
    
- un evidence bundle piccolo;
    
- le ragioni per cui il verificatore deterministico ha restituito `UNKNOWN`.
    

Il suo output deve essere `support`, `contradict`, `needs_more_evidence` con riferimenti alle evidenze ricevute. Il gate continuerà a trattare il risultato come advisory.

## 2.9 Costo token aggiuntivo

La fase deterministica non introduce token.

Per un critic residuale, una stima ragionevole è:

|Voce|Stima per skill modificata|
|---|--:|
|Claim e contesto diff|500–1.500 token|
|Evidence snippets|1.500–4.000 token|
|Risposta strutturata|300–1.000 token|
|Totale tipico|2.300–6.500 token|
|Hard cap raccomandato|8.000 token|

Molte modifiche costituite da literal, env var, file, container e config non richiederanno alcun secondo passaggio. Il costo aggiuntivo sarà quindi spesso zero.

Questa architettura può perfino ridurre il consumo totale rispetto a un secondo passaggio sulla skill completa, perché il reconciler attuale trasmette l’intero documento e l’intero contenuto di un file sorgente per ogni drift item.

## 2.10 Integrazione nei flussi esistenti

`reconcile.py` deve produrre prima un candidate file. Il verifier viene chiamato dopo la risposta LLM e prima di `atomic_write`. Soltanto `PASS` e `PASS_WITH_ADVISORIES` raggiungono la write canonica.

Il specialist `service-skills-sync` deve usare lo stesso entry point del verifier. Non deve avere un percorso di bypass soltanto perché opera localmente in un worktree.

La GitHub Action deve pubblicare il verification report come artefatto e check. `peter-evans/create-pull-request` deve essere eseguito soltanto dopo la decisione del gate.

Il reviewer umano deve vedere, oltre al diff:

- claim aggiunte o modificate;
    
- verdict per claim;
    
- evidence path e line range;
    
- complete-set comparison;
    
- residui non verificabili;
    
- source ref usato;
    
- eventuale critic advisory.
    

---

# §3 — Matter 2: retrieval architecture raccomandata

## 3.1 Reframing

Le service skill non devono essere presentate principalmente come “expert personas”. Devono essere presentate come **fonti di conoscenza operativa versionata**.

Il cataloger corrente emette “Available expert personas” e chiede all’agente di leggere esplicitamente il relativo `SKILL.md`.

L’activator corrente riutilizza correttamente il registry e il territory matcher, ma produce soltanto una stringa che invita a leggere la skill; non carica il contenuto, non verifica che sia stato consumato e non associa alcun evidence bundle all’azione successiva.

Il nuovo modello deve essere:

**task o file → servizi candidati → evidence bundle → prompt/contract → azione → telemetry sull’uso.**

Non:

**catalogo di personas → speranza che il modello scelga e legga la skill corretta.**

## 3.2 Migliore unità di retrieval

Nessuna singola granularità è adeguata a tutte le funzioni.

|Granularità|Ruolo corretto|Vantaggio|Difetto|
|---|---|---|---|
|Skill completa|Authoring e review umana|Coerenza narrativa|Costo, rumore, lost-in-the-middle|
|Sezione|Carrier principale di retrieval|Contesto sufficiente e costo moderato|Staleness interna non perfettamente localizzata|
|Claim|Verifica, provenance, conflict e invalidation|Precisione e auditabilità|Troppo frammentaria da sola|
|Probe|Evidenza runtime e azione diagnostica|Verifica osservabile|Costoso o non sempre consentito|

L’evidence bundle deve quindi contenere:

1. un’intestazione di routing;
    
2. da tre a sette claim o sezioni maggiormente rilevanti;
    
3. citation verso code/config;
    
4. stato di verifica e freshness;
    
5. conflitti o caveat;
    
6. probe read-only applicabili;
    
7. link alla skill completa.
    

La skill completa rimane disponibile tramite `knowledge_get`, ma non viene iniettata automaticamente salvo task realmente trasversali o richiesta esplicita.

## 3.3 Schema condiviso minimo

Il registry attuale contiene già i campi essenziali per routing: `name`, `description`, `skill_path`, `territory`, `triggers`, `last_sync` e `last_sync_ref`. Deve restare la source of truth per la relazione servizio-territorio.

Lo schema condiviso non deve forzare registry, issue e memory a diventare identici. Serve un envelope comune con estensioni per sorgente.

|Campo obbligatorio|Significato|
|---|---|
|`schema_version`|Versione dell’envelope|
|`id`|Identificatore stabile|
|`kind`|`service`, `section`, `claim`, `probe`, `incident`, `memory`, `reference`|
|`repo`|Repository di appartenenza|
|`service_id`|Servizio primario, quando applicabile|
|`title`|Nome presentabile|
|`description`|Summary usata da indici e retrieval|
|`text`|Contenuto recuperabile|
|`source.path`|Path canonico|
|`source.ref`|Commit o versione|
|`source.hash`|Hash del contenuto rilevante|
|`authority`|Livello della fonte|
|`status`|active, stale, conflicted, superseded, invalidated|
|`citations`|Riferimenti verificabili|
|`updated_at`|Ultima modifica significativa|

Campi raccomandati:

|Campo|Uso|
|---|---|
|`territory`|Routing deterministico|
|`triggers` e `tags`|Retrieval lessicale|
|`section_path`|Progressive disclosure|
|`claim_type`|Verifier|
|`completeness`|Set/list claims|
|`risk`|Gate|
|`valid_from`, `valid_to`|Storia temporale|
|`related_ids`|Cross-service navigation|
|`probe`|Diagnostica|
|`verification`|Verdetto e verifier version|
|`owner`|Escalation|

L’envelope segue lo spirito OKF: pochi campi obbligatori, producer extensions tollerate e consumer che preservano i campi sconosciuti. La disciplina aggiuntiva necessaria alle claim operative resta una specifica xtrm versionata, non un fork incompatibile di OKF.

## 3.4 Storage e indice

La raccomandazione MVP è un **SQLite FTS5 locale e derivato**, senza nuovo servizio.

La source of truth rimane composta da:

- `service-registry.json`;
    
- `SKILL.md`;
    
- code e configurazioni;
    
- script diagnostici;
    
- Git history.
    

SQLite contiene soltanto una proiezione rigenerabile.

Schema logico minimo:

|Tabella|Contenuto|
|---|---|
|`items`|sezioni, claim, probe e metadata|
|`items_fts`|indice FTS5 di title, description, text, tags e literal|
|`citations`|path, line range, ref, hash|
|`claims`|forma normalizzata e completezza|
|`conflicts`|claim incompatibili e authority|
|`retrieval_events`|query, candidati, bundle scelto e consumo|
|`index_state`|source ref, schema e generator version|

Esistono due opzioni di collocazione.

La prima è riutilizzare `.beads/memory-index.sqlite`, come anticipato nel design adiacente. Questa soluzione evita duplicazione del substrate, ma richiede una decisione dell’operatore perché fonde knowledge operativa e memoria.

La seconda è `.beads/service-knowledge.sqlite` o un equivalente sotto `.xtrm/cache/`. È leggermente meno elegante, ma mantiene ownership e lifecycle separati. Poiché si tratta di un file derivato, la duplicazione iniziale è meno rischiosa di una convergenza prematura.

La raccomandazione è: usare un file separato nel primo PR di retrieval; condividere il database soltanto quando il memory substrate ha una versione stabile e namespace definiti.

## 3.5 Ranking

Con 16 servizi non è giustificato un learned reranker. Il ranking deve essere interpretabile e riproducibile.

Prima si applicano filtri e boost deterministici:

1. territory esatto;
    
2. `service_id` dichiarato dal bead;
    
3. alert name, metric name, container o path esatto;
    
4. status attivo e assenza di conflitti bloccanti.
    

Poi si calcola:

**score = 0,40 T + 0,30 L + 0,15 I + 0,10 A + 0,05 F**

Dove:

|Segnale|Calcolo|
|---|---|
|`T`, territory|1,0 per path posseduto; 0,7 per servizio esplicito; 0,3 per trigger; 0 altrimenti|
|`L`, lexical|percentile del BM25 entro il candidate set|
|`I`, intent/literal|quota di trigger, path, symbol, metric e alert esatti corrispondenti|
|`A`, authority|1,0 curated+verified; 0,8 auto+verified; 0,3 unverified; 0,2 memory|
|`F`, freshness|decadimento basato su commit che hanno toccato il territorio dopo `source.ref`|

Il freshness smoothing non deve usare soltanto i giorni trascorsi. Una skill può essere vecchia ma corretta se il territorio non è cambiato. È più significativo contare i commit o i changed path nel territorio dopo `last_sync_ref`.

Un’impostazione iniziale ragionevole è:

**F = exp(−ln(2) × changed_commits / 20)**

Il valore 20 è un parametro operativo, non una costante teorica. Se il ref è assente, `F` riceve un valore basso e una stale advisory.

Penalità applicate dopo il ranking:

|Condizione|Effetto|
|---|--:|
|`conflicted` high-risk|esclusione|
|`invalidated`|esclusione|
|`stale` high-risk|−0,25|
|`insufficient_evidence` high-risk|−0,15|
|fonte non verificata|−0,10|

RRF è un metodo semplice per fondere ranking eterogenei e ha ottenuto risultati migliori dei singoli ranker negli esperimenti originari. In questa fase, però, esiste essenzialmente un ranker lessicale con segnali strutturali. RRF aggiungerebbe opacità senza reale pluralità di retriever. Deve essere introdotto soltanto quando esisteranno almeno retrieval lexical, vector e federato cross-repo.

Un learned reranker diventa giustificabile soltanto con un corpus etichettato abbastanza ampio, una failure misurata del ranking manuale e un volume di item molto superiore all’attuale.

## 3.6 Provenance e conflitti

Per la conoscenza operativa non è corretto applicare ADD-only al current truth.

La politica raccomandata è:

- storia append-only;
    
- current view mutabile;
    
- claim superata marcata `superseded` o `invalidated`;
    
- retrieval ordinario limitato a `active`;
    
- accesso storico esplicito;
    
- nessuna cancellazione dell’audit trail.
    

Ogni claim attiva deve essere legata a:

- content hash;
    
- source ref;
    
- path e line range;
    
- authority;
    
- verifier version;
    
- evidence digest.
    

Quando una fonte cambia, la claim non viene immediatamente cancellata, ma passa a `stale_pending_verification`. Per claim high-risk, il default retrieval la esclude dal bundle principale e la mostra come caveat. Per claim low-risk può restare visibile con warning finché il reconcile non termina.

Il modello temporale di Graphiti — invalidare senza cancellare e conservare provenance — è corretto concettualmente, ma può essere implementato in SQLite senza costruire un knowledge graph.

## 3.7 Firing points e capacità di blocco

|Punto|Comportamento|Blocking|
|---|---|---|
|SessionStart|Catalogo minimale, index health, servizi disponibili|No|
|Issue/bead validation|Determina servizi, territori ed evidence requirement|Sì se un task operativo non è instradabile|
|Specialist dispatch|Recupera e allega evidence bundle al contratto|Sì se il bundle richiesto non può essere costruito|
|PreToolUse Read/Glob/Grep|Recupero anticipato e cache di sessione|No|
|PreToolUse Write/Edit|Verifica che il bundle corretto sia stato caricato|Sì soltanto su territory registrato e retrieval fallito|
|PreToolUse Bash read-only|Evidence injection|Normalmente no|
|PreToolUse Bash mutating/high-risk|Bundle, conflict check e policy|Sì|
|Incident routing|Alert → servizio → runbook claim → probe|Advisory per osservazione; blocking prima di remediation automatica|
|PostToolUse|Telemetry, consumo, drift e reindex queue|No|
|Post-merge|Rebuild indice e stale invalidation|Sì per artefatti generati inconsistenti|

Il blocking deve essere raro e semanticamente motivato. Bloccare ogni tool call trasformerebbe il knowledge system in un punto di fragilità.

Il gate più importante è il dispatch: un bead che tocca `api-gateway/**` deve contenere o referenziare il bundle prodotto per `api-gateway`, indipendentemente dal fatto che il modello “si ricordi” di leggere la skill.

## 3.8 Superficie MCP e CLI

Il primo set di tool deve essere read-only e stretto:

|Tool|Funzione|
|---|---|
|`knowledge_search`|Ricerca query, path, servizio o intent|
|`knowledge_get`|Recupera un item o una skill completa|
|`knowledge_evidence_for_files`|Produce bundle per una lista di path|
|`knowledge_probes`|Elenca probe applicabili e prerequisiti|
|`knowledge_conflicts`|Mostra conflitti o claim stale per un servizio|

Non deve esistere un endpoint `answer()`. Il knowledge layer restituisce evidenze, non conclusioni.

Non devono essere aggiunti nel MVP tool di write, auto-memory, editing delle skill o remediation operativa.

La scelta di tool piccoli è coerente sia con il pattern MCP descritto nel prompt sia con la memoria client-side e just-in-time di Anthropic.

## 3.9 Valutazione

Il benchmark utile non è una raccolta di domande generiche sulle skill. Deve derivare da lavoro realmente svolto.

Il corpus iniziale dovrebbe contenere da 80 a 150 casi provenienti da:

- issue chiuse;
    
- PR con modifiche operative;
    
- alert reali;
    
- incident report;
    
- drift storici;
    
- task di diagnostica;
    
- domande che in passato hanno prodotto comandi impropri o claim sbagliate.
    

Per ogni caso si etichettano:

|Campo|Descrizione|
|---|---|
|`query_or_task`|Prompt, bead o alert iniziale|
|`touched_paths`|File realmente interessati|
|`expected_services`|Servizi corretti|
|`required_evidence`|Claim o sezioni indispensabili|
|`forbidden_evidence`|Claim stale o fuorvianti|
|`expected_probes`|Probe pertinenti|
|`cross_repo_required`|Booleano|
|`outcome`|Diagnosi o modifica corretta|

Metriche:

|Metrica|Scopo|
|---|---|
|Service routing precision/recall|Selezione del servizio corretto|
|Retrieval precision@K|Rumore del bundle|
|Retrieval recall@K|Evidenza necessaria recuperata|
|Citation utilization rate|Evidenza realmente richiamata dall’agente|
|Ignored activation rate|Bundle caricato ma non usato|
|Stale-claim escape rate|Claim non più valida entrata nel prompt o output|
|Conflict detection recall|Contraddizioni intercettate|
|Verification false-positive rate|Claim corretta erroneamente bloccata|
|Verification false-negative rate|Claim falsa lasciata passare|
|Probe execution rate|Uso di diagnostica canonica|
|Time to first correct diagnostic|Impatto operativo|
|Tokens per successful task|Efficienza|

La metrica primaria di sicurezza deve essere lo **stale-claim escape rate**, non il numero di skill aggiornate.

## 3.10 Quando serve un indice cross-repo

Il per-repo FTS5 deve restare il default.

Il primo incremento utile non è un KB centralizzato, ma una query federata:

1. ogni repo mantiene il proprio indice;
    
2. un piccolo stack registry conosce le repo sorelle;
    
3. il client interroga gli indici locali;
    
4. combina i top result;
    
5. mantiene provenance verso la repo originale.
    

Il passaggio a un aggregatore persistente è giustificato quando almeno una di queste condizioni è misurata:

|Trigger|Soglia iniziale suggerita|
|---|--:|
|Incidenti etichettati che richiedono più repo|oltre 20%|
|Recall@5 perso per assenza di evidenza cross-repo|oltre 10 punti percentuali|
|Numero di stack/repo operativi|oltre 3–5 stack stabilmente correlati|
|Necessità multi-user e ACL|requisito esplicito|
|Query federate troppo lente|p95 oltre il budget deciso dall’operatore|

Un indice vector diventa candidabile soltanto se BM25 e segnali strutturali non raggiungono il target di recall sulle query parafrasate. Sourcegraph dimostra che un sistema code-aware può scalare molto utilizzando search e ranking strutturale senza dipendere obbligatoriamente da embeddings.

---

# §4 — Integration points

|Componente esistente|Decisione|Estensione specifica|
|---|---|---|
|`service-registry.json`|Keep + extend|Conservare ownership, territory, triggers e sync ref; aggiungere schema version ed eventuali authority/risk defaults|
|`drift_detector.py`|Keep + extend|Restituire affected services, changed paths, base/head ref e source hashes; non usarlo come prova fattuale|
|`reconcile.py`|Extend profondamente|Scrivere candidate temporanea, chiamare verifier, applicare gate, poi eventualmente effettuare atomic write|
|`skill_activator.py`|Keep matcher, replace behavior|Da reminder a retrieval reale, bundle injection e session cache|
|`cataloger.py`|Keep + reframe|Sostituire “expert personas” con “operational knowledge sources”; mostrare index status e schema|
|Umbrella skill|Keep come indice|Considerarla superficie derivata, non evidence source|
|`umbrella_generator.py`|Extend|Generare hash/ref/index health e OKF-compatible descriptions|
|`service-skills-sync` specialist|Keep|Obbligare l’uso dello stesso verifier della CI|
|PostToolUse drift hook|Keep ridotto|Drift telemetry, stale marking e reindex scheduling|
|PreToolUse hook|Upgrade|Retrieval prima dell’azione; blocking soltanto per failure ad alto rischio|
|Bead contract validator|Extend|`matched_services`, `evidence_bundle_id`, `evidence_hash`, unresolved conflicts|
|Semantic markers|Keep|Protezione hard per blocchi presenti; migrazione progressiva per le skill mancanti|
|Scaffolder|Extend|Nuovo frontmatter/version envelope e sezioni identificabili|
|Migrator|Keep|Migrazione incrementale, una skill alla volta|
|Deep-dive|Extend|Produrre claim candidate e citations, senza attribuire loro stato verified|

Il drift detector già distingue servizi, file, source ref e alcuni livelli di impatto, e può usare GitNexus per l’enrichment. Questa machinery va riutilizzata per determinare il perimetro della verifica, ma non deve essere confusa con una verifica della documentazione.

L’umbrella attuale è correttamente dichiarata come generata dal registry, contiene un blocco semantico protetto e rimanda alle singole skill. È già molto vicina a un `index.md` OKF-style; non occorre sostituirla.

---

# §5 — Open questions per l’operatore

## 5.1 Auto-merge

La decisione principale è quali classi di claim potranno mai essere auto-merged.

La proposta prudente è autorizzare in futuro soltanto claim con verifier strutturale completo: path, simboli, literal, env var, immagini e configurazioni statiche. Failure mode, causalità, security posture, procedure distruttive e complete set dinamici restano con review.

## 5.2 Relazione con il memory substrate

Occorre decidere se l’indice service knowledge debba:

- vivere separatamente;
    
- condividere lo stesso database con `.beads/memory-index.sqlite`;
    
- diventare una namespace dello schema `memory_item`.
    

La scelta non blocca il verifier. Blocca soltanto la collocazione definitiva dell’indice di retrieval.

## 5.3 Authority exceptions

Alcuni fatti potrebbero essere intenzionalmente definiti dalla documentazione invece che dal codice, ad esempio policy operative, ownership e decisioni di escalation. Serve un modo esplicito per dichiarare una fonte curatoriale come autoritativa per una classe di claim.

## 5.4 Probe runtime

Bisogna stabilire quali probe possano essere eseguiti:

- in CI;
    
- su host di sviluppo;
    
- su staging;
    
- su produzione;
    
- durante incident response.
    

Il primo rollout dovrebbe indicizzare i probe senza eseguirli automaticamente.

## 5.5 Retention

La storia append-only può crescere. Serve una policy per mantenere claim superseded, evidence bundle e retrieval telemetry. Per una baseline di 16 servizi, la dimensione non è un problema immediato; la decisione può essere rinviata.

## 5.6 Territory overlap

Diverse skill possiedono porzioni di `docker-compose.yml`. L’ownership deve consentire molti-a-molti e distinguere:

- ownership primaria;
    
- ownership secondaria;
    
- shared infrastructure;
    
- cross-service evidence.
    

Il comportamento corrente che restituisce il primo servizio corrispondente non è sufficiente per retrieval e verifica cross-service.

## 5.7 Embeddings e cross-repo

Entrambi devono rimanere gated on operator greenlight. Il trigger deve essere una failure misurata, non la sola disponibilità tecnologica.

---

# §6 — Ship in order

## PR 1 — Claim verifier foundations

Aggiungere taxonomy, Markdown diff parser, claim manifest, structural validator ed evidence report in modalità advisory.

Il PR riusa:

- registry;
    
- drift detector;
    
- semantic markers;
    
- current service skills come fixture;
    
- Git refs esistenti.
    

Non cambia il comportamento di reconcile e non blocca nulla.

Acceptance:

- estrazione riproducibile delle claim modificate;
    
- parser per YAML/frontmatter e tabelle;
    
- fixture per env var, container, image, metric label, set completo e citation;
    
- report JSON e Markdown;
    
- golden tests ricavati almeno da Alertmanager e API gateway.
    

## PR 2 — Deterministic gate nel reconcile

Modificare `reconcile.py` affinché:

1. generi una candidate temporanea;
    
2. esegua il verifier;
    
3. non scriva su `CONFLICT` o `INVALID`;
    
4. invalidi il run su source race;
    
5. produca draft/non-mergeable output su high-risk unknown;
    
6. scriva soltanto su pass.
    

Integrare lo stesso comando nel specialist `service-skills-sync`.

Questo PR risolve direttamente il blast radius senza dipendere dal nuovo retrieval system.

## PR 3 — Per-repo FTS5 evidence index

Costruire l’indice derivato locale a partire da:

- registry;
    
- skill headings;
    
- claim manifest;
    
- citations;
    
- probe metadata.
    

Aggiungere CLI o MCP read-only:

- `knowledge_search`;
    
- `knowledge_get`;
    
- `knowledge_evidence_for_files`;
    
- `knowledge_probes`;
    
- `knowledge_conflicts`.
    

Aggiornare il cataloger affinché mostri knowledge sources e index health.

Embeddings, reranker LLM e cross-repo sono esplicitamente esclusi.

## PR 4 — Dispatch e PreToolUse integration

Estendere il bead validator con:

- servizi rilevati;
    
- evidence bundle ID;
    
- bundle hash;
    
- unresolved conflicts.
    

Modificare l’activator per eseguire retrieval reale e mantenere una cache per sessione.

Il blocking iniziale riguarda soltanto:

- Write/Edit in un territory registrato quando il retrieval non funziona;
    
- comandi mutating high-risk;
    
- claim conflicted richieste come prerequisito.
    

Read, Glob, Grep e osservazione incident rimangono non bloccanti.

## PR 5 — Evaluation, telemetry e canary policy

Creare il corpus etichettato, registrare retrieval events e misurare:

- routing;
    
- precision/recall;
    
- bundle consumption;
    
- stale escapes;
    
- false-positive e false-negative del verifier;
    
- token cost.
    

Integrare alert-to-service routing e post-merge reindex.

Soltanto dopo questa fase può essere introdotto un canary di auto-merge per claim low-risk completamente deterministiche.

La sequenza resta sotto sei PR, e ogni PR è indipendentemente reviewable e revertibile.

---

# §7 — Rischi e non-goals

## Rischi

Il parser può non riconoscere claim espresse in prosa complessa, producendo falsi negativi.

L’estrazione automatica di completezza può attribuire semantica troppo forte a una frase ambigua. Per questo `unknown` deve essere il default.

Config overlay, dynamic labels, templating e runtime substitution possono rendere incompleta la static analysis.

Una gerarchia di authority errata può far prevalere una configurazione non deployata su una policy operativa intenzionale.

Blocking troppo aggressivo può indurre gli agenti o gli operatori a bypassare l’intero sistema.

Il derived index può divergere dalla source of truth se rebuild e source ref non sono atomici.

L’indicizzazione di file renderizzati o output runtime potrebbe accidentalmente acquisire secret. Devono essere estratti soltanto nomi, struttura e redacted evidence; mai valori sensibili.

Probe apparentemente read-only possono comunque avere costi o effetti su sistemi esterni. La loro esecuzione richiede policy distinta.

## Non-goals

Questo rollout non costruisce:

- un nuovo servizio;
    
- un database Postgres;
    
- un vector database;
    
- un temporal knowledge graph;
    
- un general-purpose organizational KB;
    
- un connettore Slack;
    
- un sistema di risposta automatica;
    
- un LLM nel ranking hot path;
    
- un panel di modelli come fonte di verità;
    
- remediation automatica di produzione;
    
- una riscrittura simultanea di tutte le skill;
    
- una sostituzione del registry;
    
- una sostituzione della memoria Dolt-backed;
    
- una garanzia che la causalità operativa sia deducibile staticamente dal codice.
    

## Decisione finale

La soluzione minima che produce valore reale è composta da tre primitive condivise:

**claim extraction deterministica**, usata dal verifier e dall’indice;

**provenance con hash e source ref**, usata da gate, freshness e conflict handling;

**evidence bundle read-only**, usato da bead validation, dispatch, PreToolUse e incident routing.

Il verifier deve essere spedito prima del retrieval system, perché elimina il rischio più immediato: una skill falsa che diventa fonte per tutte le sessioni future.

Il retrieval system deve essere spedito subito dopo, perché una skill corretta ma mai consumata non migliora il comportamento degli agenti.

La combinazione risolve i due problemi con la stessa plumbing, senza introdurre nuovi servizi, vector storage o LLM nel percorso caldo.