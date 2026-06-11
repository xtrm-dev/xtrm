---
date_created: Wednesday, May 13th 2026, 1:02:49 am
date_modified: Wednesday, May 13th 2026, 1:03:59 am
created: 2026-06-07T02:22
updated: 2026-06-09T01:35
---
Sì, questa rimappatura è corretta. È molto più solida della versione iniziale.

Il cambiamento chiave è che gli specialist non devono validare “la matematica”; devono produrre materiale verificabile dai validator. In pratica diventano generatori di specifiche, composizioni, failure cases, convenzioni e test inferenziali. Questo è il posto giusto per gli agenti.

Io la formalizzerei così:

```text
Intent
  ↓
SpecAgent
  ↓
CompositionAgent
  ↓ success: mq audited composition
  ↓ failure: FormulaDerivationAgent → novel mq candidate
  ↓
PythonImplementationAgent
  ↓
StaticAnalysis / Convention Lookup
  ↓
Mercury save_result()
  ↓
Layer 1 + Layer 2 built-in validators
  ↓
Layer 3 .mercury/validators.py
  ↓
Adversarial inferential tests
  ↓
Promotion gate
```

La distinzione più importante è questa:

```text
mq = audited quantitative primitives
mc = composition / orchestration layer
validators = truth layer
agents = semantic/test-generation layer
```

Questa separazione evita che il sistema degeneri in “multi-agent consensus”, che in ambito quant è pericoloso. Il consenso tra agenti non vale nulla se non produce invarianti, test, schema e artefatti verificabili.

Il `CompositionAgent` dovrebbe avere una policy molto rigida:

```yaml
default_policy:
  prefer_existing_mq: true
  allow_novel_math: false
  require_reason_if_composition_fails: true
  output:
    - selected_mq_methods
    - dependency_graph
    - missing_capabilities
    - fallback_required
```

Solo se fallisce:

```yaml
fallback:
  allow_formula_derivation: true
  mark_as: novel_math_not_in_mq
  requires:
    - symbolic_tests
    - numerical_tests
    - TestXxx registration
    - human_review_if_custom_schema
```

Per `event_study`, concordo: va promosso a built-in. Non dovrebbe dipendere dall’agente. Minimo schema:

```yaml
schema_type: event_study
required:
  - event_time
  - window_pre
  - window_post
  - metric
  - grouping_keys
  - n_min
  - multiple_testing_correction
  - ci_method
defaults:
  n_min: 30
  mt_correction: bh_fdr
  ci_method:
    rate: wilson
    correlation: fisher_z
    mean: bootstrap_or_t
checks:
  - no_overlap_leakage
  - no_future_data
  - per_bucket_power
  - fdr_adjusted_pvalues
  - extreme_event_sensitivity
```

Per me i `KNOWN_TYPES` iniziali dovrebbero essere pochi ma duri:

```python
KNOWN_TYPES = {
    "event_study",
    "signal_evaluation",
    "cross_asset_corr_study",
    "regime_classification",
    "vol_forecast_eval",
    "spread_decomposition",
}
```

Ogni tipo deve avere validator built-in. Gli agenti possono estendere Layer 3, ma non sostituire i built-in.

Sul `MarketConventionAgent`, trasformarlo in lookup è la scelta giusta. La struttura YAML dovrebbe essere molto esplicita:

```yaml
instrument: SR3
asset_class: STIR
price_to_rate:
  formula: implied_rate = 100 - price
  unit: percent
spread_convention:
  default: front_price_minus_back_price
  interpretation:
    spread_down: front_price underperforms back_price
    spread_up: front_price outperforms back_price
rate_mapping:
  price_up: implied_rate_down
  price_down: implied_rate_up
day_count: ACT/360
currency: USD
critical_warnings:
  - Do not describe SR3 calendar spread as front_rate_minus_back_rate unless explicitly converted.
```

L’agente non deve “sapere” questa cosa. Deve solo selezionare la convention corretta e allegarla allo script/spec.

Il punto più forte del tuo aggiustamento è il ruolo nuovo del `NumericalTestAgent`: non esegue test, scrive validator. Questo mantiene pulita la responsabilità.

Output desiderato:

```python
# .mercury/validators.py

def validate_event_study(result, ctx):
    assert_min_bucket_n(result, n_min=ctx.spec.n_min)
    assert_fdr_applied(result, method=ctx.spec.mt_correction)
    assert_wilson_ci_for_rates(result)
    assert_no_event_window_overlap(result)
    assert_extreme_event_robustness(result)
```

Poi Mercury esegue. Non l’agente.

La promotion gate che hai scritto è quasi giusta. Aggiungerei solo due condizioni:

```text
✓ convention YAML version hash recorded
✓ generated validators are persisted with result artifact hash
```

Perché altrimenti non sai se un risultato è stato prodotto con la vecchia o nuova convenzione.

Quindi la versione finale del gate:

```text
promote only if:
  ✓ Layer 1+2 validators pass
  ✓ Layer 3 validators pass
  ✓ adversarial inferential tests pass
  ✓ composition usa solo mq audited methods,
     OPPURE nuovo metodo mq ha TestXxx registrata
  ✓ static analysis: no t+1 reference in feature pipeline
  ✓ market convention resolved from versioned YAML
  ✓ convention YAML hash recorded
  ✓ n_min soddisfatto per ogni bucket,
     OPPURE bucket flaggato underpowered=true
  ✓ schema_type ∈ KNOWN_TYPES,
     OPPURE custom con review umana esplicita
  ✓ result artifact, spec, validators, mq version and convention hash persisted
```

Direi che i tre interventi prioritari sono esattamente quelli che hai identificato. Io li ordinerei così:

Primo: `KNOWN_TYPES` + built-in validators per `event_study`.  
Secondo: `CompositionAgent` prima di qualsiasi derivazione.  
Terzo: conventions YAML versionata e lookup-only.

Questa è la differenza tra un sistema agentico “intelligente” e un sistema quant realmente auditabile. Qui gli agenti aumentano la superficie produttiva, ma non diventano mai il punto di verità.