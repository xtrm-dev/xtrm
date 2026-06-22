PREMORTEM FRAME: It is December 2026 — six months from today. The "Substrate" runtime architecture proposed in `substrate_design_it.md` has FAILED. The runtime entities never became real in production, or shipping them produced more pain than the tribal practices they were meant to replace. Your job is to explain why, working backward from the failure.

THE PLAN UNDER PREMORTEM (compressed):

Substrate is a proposed runtime architecture for the `xtrm` monorepo. Five npm packages (core, substrate, channels, specialists, console) sharing one SQLite store served by `xt daemon` over a Unix socket; all packages are clients of the socket. It replaces tribal orchestrator practices and the existing sp+bd+GitHub materializer (treated explicitly as "throwaway", no coexistence shim).

Core entities introduced:
- containers (5 kinds: seed, chain, epic, wave, node), each with a lifecycle: open → working → converging → ready → closed (+ escalated)
- a new issue schema with three classifiers (class/type/role), a 2-stage validator + a 3rd entry-gate moment at container start
- chain templates with worktree-lease, two layers of git axis (container kind × chain shape)
- a live cross-worktree collision matrix at file granularity
- plan artifacts produced by the "seed" container kind (planning channel between advisors)
- channels as standalone package with own domain tables
- memory-as-capability (no curator role) with retention per-query, not per-field
- emitter/pulse signal layer with idempotency-key dedup
- per-step skill injection (React, Docker, Postgres skill packs etc.)
- participant SDK surface (specialist is one kind; scripts/services/coordinators/external are others)
- "tether" decorator for always-on context to running jobs
- console as a thin read-only renderer over runtime state

The five problems substrate claims to solve (from §1):
1. Chains are implicit — no `sb container ps chain:X`
2. Preflight is discretionary — issue quality is unguarded
3. Collisions emerge only at integration, ~6h after they're inevitable
4. Memory recall is FTS5 text-match, not relevance
5. Issues are unstructured prose

Sequencing (13 stages; all serially dependent on stage 0):
0 daemon + state.db + Unix socket · 1 issue schema + Stage-1 validator · 2 channels v0 · 3 tether v0 · 4 container entity (chain only) + lifecycle · 5 seed channel · 6 plan artifact + approval · 7 collision matrix (file-level) · 8 epic/wave container kinds · 9 advisor invite rules · 10 tether layer 2 (small-model relevance) · 11 reconciler specialist · 12 console renders against merged feed · 13 bd → substrate data migration (no shim, clean cutover)

Architecture decisions worth flagging:
- Two-tier deployment: bottom (local SQLite, always authoritative) + optional top (Supabase, team/company). Top tier is read-mostly projection.
- No FK cross-domain; correlation only by opaque ID
- 5-layer identity model; `participant_id` stable for `(scope, role)`, `job_id` per activation
- Chain coordinator (§4.3) is a "permanent judge of a transient container" with fresh-context spawning, kill+respawn semantics, journal-based gap detection, and `coordinator_model: null` no-LLM reducer mode
- Node coordinator (§4.2) is a long-running autonomous "fifth container kind" with policy-bounded ability to open child containers
- Console redesign + lineage drawer + AWS-agentcore observability are explicitly deferred — substrate ships without them

Status: "Bozza (revisione 12)". Round-3 audit closed 2026-06-07 with 11 inline warnings resolved + 1 `/open` marker. Multiple operator-notes absorbed across rev 9–12. §6.7 issue relationships acknowledged as under-drilled, tracked as a separate bead. Author and implementer are the same operator/agent.

YOUR JOB:

You are running the 4-phase Overthinker workflow on ONE assigned failure reason. The full workflow is required (do not skip phases) — but the only thing that needs to land in the final output is the "## Final Answer" section in the EXACT format below. The earlier phases run, you can show them, but they're scaffolding.

THE "## Final Answer" SECTION MUST CONTAIN, IN THIS ORDER:

### The Failure Story
2–3 paragraphs of concrete narrative. How did this specific failure play out month-by-month over the 6 months? Use details from the plan above. Name specific moments where things went wrong and why. Be specific — "stage 0 took 3 months and stages 1–4 each got 2 weeks" is good; "things took longer than expected" is bad.

### The Underlying Assumption
ONE sentence. The single thing the designer was taking for granted that made this failure possible. Should be sharp enough that, once named, the designer would say "oh — yeah, I was assuming that."

### Early Warning Signs
1–2 concrete, observable signals the operator could watch for RIGHT NOW (June 2026) that would indicate this failure mode is starting to play out. These must be things you can actually see or measure — a metric, an artifact, a behavior pattern — not vague feelings like "watch for scope creep."

Total "## Final Answer" section under 350 words. Be direct. Do not hedge. Do not sugarcoat. If the assigned failure reason is real, name it plainly.

YOUR ASSIGNED FAILURE REASON:
Console deferred — substrate ships invisible. §16 says explicitly: "the runtime models the entities; the dashboard reveals them." The whole premise of substrate is that operators can finally see chains, containers, collisions, plans, and lineage as first-class things. But §14 explicitly defers the console redesign + lineage drawer + AWS-agentcore observability to "downstream" work in `~/dev/gitboard`. The console product contract and the lineage UX are marked `*/open` and are not in the substrate stage plan. Stage 12 of the sequencing is "console renders against merged `sp feed -f` + `sb feed -f`" — that's a stream-fusion CLI feed, not the entity-aware dashboard the design promises. Six months in, substrate is real but invisible: chains exist with stable IDs in the daemon, the collision matrix is populated, plan artifacts are stored — and operators have no UI to look at any of it. They keep reading `sp feed` and `bd show` because the visualization layer that justified the architecture cost hasn't caught up. Substrate becomes a backend with no front, and adoption stalls on "what's the point if I still can't see what's happening."
