---
date_created: Sunday, May 31st 2026, 10:32:36 am
date_modified: Sunday, May 31st 2026, 10:33:46 am
---
Sì. Il problema non si risolve dicendo all’agente “usa package esistenti”. Quella regola è troppo debole. Devi renderla una fase obbligatoria del workflow, con evidenza scritta e con un hook che fallisce o blocca quando manca la giustificazione.

Nel tuo caso, la regola corretta è: **l’agente non può scrivere implementazioni custom per domini notoriamente standardizzati finché non ha prima eseguito una dependency/API discovery pass e prodotto una decisione di riuso.** Per esempio: calendari di mercato, date/time, auth, retry/backoff, parsing, rate limiting, terminal emulation, schedulazione, time zone, grafici, diff, AST, LSP, caching, queue, validation, finance calendars. Sono aree dove il default deve essere “cerca libreria”, non “scrivi codice”.

L’esempio dei futures calendars è perfetto. Esistono librerie come `pandas_market_calendars`, che fornisce calendari di mercato per trading application e include anche calendari specifici per futures; la documentazione segnala perfino che le regole sono distribuite come codice del package, quindi non sono un feed live runtime: vanno aggiornate aggiornando il package o il sorgente. Questo è esattamente il tipo di dominio in cui un agente non dovrebbe hardcodare orari dopo ore di ricerca, salvo casi esplicitamente motivati. ([PyPI](https://pypi.org/project/pandas_market_calendars/?utm_source=chatgpt.com "pandas_market_calendars"))

Io imposterei tre livelli: rule, skill/harness, enforcement.

La **rule** deve essere breve, aggressiva e verificabile. Non “preferisci package esistenti”, ma qualcosa del genere:

```md
# Reuse-before-build rule

Before implementing any non-trivial logic, the agent MUST perform a reuse check.

The agent may not write custom implementations for standard domains such as calendars, market sessions, time zones, scheduling, parsing, retries, auth, queues, caching, diffing, graph traversal, code indexing, validation, statistics, math, finance conventions, or protocol clients unless it first documents why existing libraries are unsuitable.

Required before coding:
1. Identify the capability being implemented.
2. Search the current repo for existing internal utilities.
3. Search installed dependencies and package manifests.
4. Search known package registries or the approved dependency catalog.
5. Prefer battle-tested packages over custom code.
6. If writing custom code, include a `CUSTOM_IMPLEMENTATION_JUSTIFICATION` block.

A custom implementation is allowed only when at least one condition is true:
- no maintained package exists;
- existing packages fail a required correctness constraint;
- dependency risk is higher than custom implementation risk;
- licensing is incompatible;
- performance/latency requirements are proven and measured;
- the implementation is a small adapter around an existing package, not a reimplementation.

Forbidden:
- hardcoding market hours, exchange holidays, DST rules, time zone rules, protocol behavior, retry policies, parsers, or statistical formulas without checking libraries first;
- writing long bespoke code for standard infrastructure;
- using memory-based assumptions when package/documentation lookup is available.
```

Poi serve una **skill operativa** che l’agente deve chiamare prima di scrivere codice. Nel tuo stack la chiamerei qualcosa tipo `dependency-first-development` o `reuse-gate`. Deve produrre un output strutturato, perché solo così puoi validarlo in hook.

Esempio di formato obbligatorio:

```md
## Reuse Gate

Capability:
Market calendar and futures session schedule resolution.

Existing repo utilities checked:
- packages/...: none found
- apps/...: partial adapter only

Installed dependencies checked:
- package.json / pyproject.toml / requirements.txt: none suitable

Candidate packages:
- pandas_market_calendars: supports market calendars and futures calendars
- exchange_calendars: related calendar source/ecosystem

Decision:
Use pandas_market_calendars via a thin adapter.

Custom code allowed:
Only adapter, normalization, tests, and MCP tool wiring. No hardcoded exchange hours or holidays.

Risk:
Calendar data is package-versioned, not live. Add package update policy/test fixtures.
```

Questo cambia il comportamento dell’agente perché gli dai una “uscita naturale”: invece di inventare, deve produrre una decisione. E se vuole inventare, deve esporsi.

Il terzo livello è l’**enforcement hook**. Qui devi intercettare patch grandi o pattern sospetti prima che vengano accettati. Per Pi / coding-agent, ha senso perché Pi sembra esporre un modello estensibile con hooks/extensions; c’è anche discussione pubblica su estensioni Pi basate su “standard Pi hooks”, quindi il punto architetturale è coerente: non affidarti solo al prompt, metti un hook nel runtime. ([innobu](https://www.innobu.com/en/articles/pi-coding-agent-minimalism.html?utm_source=chatgpt.com "Pi Coding Agent: The AI Architecture That Builds Itself"))

La logica dell’hook dovrebbe essere questa: dopo ogni proposta di patch, analizza diff e file modificati. Se vede molte linee nuove in domini “standardizzati”, oppure keyword sospette, richiede il `Reuse Gate`. Se il gate manca, blocca. Se il gate dice “custom”, richiede una giustificazione. Se la giustificazione è debole, blocca o manda a review.

Pattern sospetti concreti:

```txt
market hours
exchange calendar
holiday
DST
timezone
trading session
cron
scheduler
retry
backoff
parser
tokenizer
diff
cache
queue
rate limit
auth
websocket reconnect
statistics
volatility
calendar spread
business day
settlement date
```

E segnali strutturali:

```txt
new file > 150 LOC
function > 80 LOC
many hardcoded dates
many hardcoded times
large switch/case over exchanges
large object literal of market schedules
manual timezone offset handling
custom parser with regex chains
custom retry loop
custom scheduler
custom cache
custom queue
```

Per il tuo ecosistema GitNexus / specialists / MCP, io la metterei proprio come front-door: `specialist → GitNexus/internal dependency query → package discovery → AST patch → optional Serena/LSP verify`. Hai già la direzione giusta: GitNexus non deve essere solo code search, deve essere anche “reuse memory”. Gli specialist non devono fare discovery indipendente dalla loro memoria.

Il design migliore è avere un **Approved Capability Catalog** versionato nel repo, per esempio:

```yaml
capabilities:
  market_calendars:
    default: pandas_market_calendars
    alternatives:
      - exchange_calendars
    forbidden:
      - hardcoded exchange hours
      - manually maintained holiday tables
      - DST offset logic
    allowed_custom_code:
      - thin adapters
      - MCP schemas
      - tests
      - normalization layer

  retries:
    default_ts:
      - p-retry
      - async-retry
    default_py:
      - tenacity
    forbidden:
      - hand-written exponential backoff loops without jitter

  datetime:
    default_ts:
      - date-fns
      - luxon
      - temporal-polyfill
    default_py:
      - zoneinfo
      - pandas
      - pendulum
    forbidden:
      - manual timezone offsets
      - hardcoded DST rules

  validation:
    default_ts:
      - zod
    default_py:
      - pydantic
    forbidden:
      - ad hoc object validation over many fields
```

Questo catalogo diventa parte della policy. L’agente non deve “sapere” che esiste `pandas_market_calendars`; lo deve leggere dal catalogo. E quando scopri un caso come quello dei futures hours, non lo risolvi una volta: aggiungi la capability al catalogo e diventa impossibile o almeno molto più difficile ripetere l’errore.

A livello di hook, la forma potrebbe essere:

```ts
type ReuseGateResult = {
  capability: string;
  searchedRepo: boolean;
  searchedDependencies: boolean;
  searchedRegistryOrCatalog: boolean;
  candidates: string[];
  decision: "reuse_package" | "internal_utility" | "custom_allowed" | "blocked";
  selectedPackage?: string;
  customJustification?: string;
};
```

Regola di blocco:

```ts
if (patchLooksLikeStandardDomain(diff) && !hasReuseGate(agentOutput)) {
  fail("Missing Reuse Gate. Search existing repo utilities and packages before implementing custom logic.");
}

if (patchLooksLikeCalendarLogic(diff) && containsHardcodedMarketHours(diff)) {
  fail("Hardcoded market calendar/session logic is forbidden. Use approved market calendar package or provide explicit exception.");
}

if (customImplementationLarge(diff) && !hasStrongCustomJustification(agentOutput)) {
  fail("Large custom implementation requires CUSTOM_IMPLEMENTATION_JUSTIFICATION.");
}
```

La cosa importante: non devi bloccare ogni custom code. Devi bloccare **custom code non giustificato in capability standard**. Altrimenti gli agenti diventano inutili. Devono poter scrivere adapter, integrazioni MCP, test, mapper, normalizzatori, tipi, schemi, glue code. Quello che non devono fare è implementare da zero calendari, parser, scheduler, retry, code indexing o librerie finance perché “gli sembrava semplice”.

Io aggiungerei anche una regola specifica per gli MCP server:

```md
# MCP implementation rule

When adding an MCP tool, the agent should implement orchestration, schema validation, adapters, and response shaping.

The agent must not implement domain knowledge directly inside the MCP server when a maintained package or internal service exists.

MCP tools should wrap authoritative sources, not become the source of truth.
```

Questa è centrale. Il tuo MCP non deve contenere la verità sugli orari dei futures. Deve esporre una capability tipo `get_market_schedule`, ma la verità deve venire da un package, database, vendor feed, o catalogo controllato. L’MCP è un’interfaccia, non una enciclopedia hardcoded.

Per renderla ancora più robusta, crea un comando agente dedicato:

```txt
/reuse-check <task>
```

Output obbligatorio:

```txt
Recommended implementation: package | internal utility | custom
Package candidates:
Internal candidates:
Risks:
Decision:
Allowed code shape:
Forbidden code shape:
```

Poi imponi che ogni task di coding non banale parta da `/reuse-check`. Per task piccoli può essere implicito, ma per ogni modifica sopra una certa dimensione diventa obbligatorio.

La parte più efficace, secondo me, è questa regola sintetica da mettere nel system/developer prompt degli agenti:

```md
You are not rewarded for writing code. You are rewarded for reducing custom code.

Before implementing, ask: “Is this a known solved problem?”
If yes, use an existing maintained package or internal utility.
If no, prove that reuse is unsuitable.

Default output should be:
- thin adapter
- tests
- integration wiring
- typed schema
- documentation

Avoid:
- reimplementing libraries
- encoding external domain facts manually
- writing long procedural code from memory
```

Per il caso specifico `market-calendars`, io aggiungerei subito una policy nel catalogo:

```yaml
market_sessions:
  status: standard_domain
  source_of_truth:
    python:
      preferred: pandas_market_calendars
      notes:
        - Package contains market calendars for trading applications.
        - Calendar rules are package-versioned, not live runtime data.
        - Keep package updated and add regression fixtures for key markets.
  forbidden:
    - hardcoded futures open/close hours
    - hardcoded holidays
    - manual DST logic
    - exchange session tables written by the agent
  allowed:
    - MCP wrapper
    - calendar lookup adapter
    - normalized response schema
    - tests comparing known sessions
    - fallback error handling
```

C’è anche un motivo accademico/pratico per farlo così: il riuso di librerie riduce tempo e bug, ma le opportunità di riuso spesso non sono ovvie, quindi gli sviluppatori — e ancora di più gli agenti — le mancano. Esistono perfino lavori su sistemi che identificano implementazioni custom sostituibili con API open source. ([arXiv](https://arxiv.org/abs/2208.07624?utm_source=chatgpt.com "Don't Reinvent the Wheel: Towards Automatic Replacement of Custom Implementations with APIs"))

Quindi la soluzione finale non è “prompt più severo”. È questa pipeline:

```txt
Task
→ classify capability
→ check internal utilities
→ check dependency manifests
→ check approved capability catalog
→ optional registry search
→ produce Reuse Gate
→ only then patch
→ hook scans diff
→ block custom reinvention unless justified
```

Nel tuo caso la chiamerei **Reuse Gate** o **Dependency First Gate**. È abbastanza generale da valere per tutti gli agenti, ma abbastanza concreta da bloccare casi reali come futures calendars, retry, scheduler, parsers e time zone.