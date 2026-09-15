▶ A1 §84 fresh-repository onboarding
  ✔ sb init detects, binds, detects base branch, works flagless, is idempotent (308.192589ms)
✔ A1 §84 fresh-repository onboarding (313.20361ms)
▶ A1 §85 multi-repository isolation (release blocking)
  ✔ uninitialized repository fails closed with sb init guidance and leaks nothing (507.738374ms)
  ✔ after init in B, A sees only A and B only B (396.668901ms)
✔ A1 §85 multi-repository isolation (release blocking) (913.205787ms)
▶ A1 §86 worktree resolution
  ✔ main, linked and detached worktrees resolve one Project (505.184944ms)
✔ A1 §86 worktree resolution (509.865205ms)
▶ A1 §87 multi-clone identity
  ✔ two checkouts of one canonical remote share one Project (477.831606ms)
✔ A1 §87 multi-clone identity (485.606465ms)
▶ A1 §88 remote normalization and credential stripping
  ✔ equivalent remote forms share one key; credentials never persist (423.465997ms)
✔ A1 §88 remote normalization and credential stripping (432.049712ms)
▶ A1 §89 basename-collision determinism
  ✔ org-a/service and org-b/service get different deterministic Projects (494.804102ms)
✔ A1 §89 basename-collision determinism (500.250143ms)
▶ A1 §90 existing-store adoption without renumbering
  ✔ sb init adopts the existing Project, refs and history unchanged (230.890933ms)
✔ A1 §90 existing-store adoption without renumbering (233.498336ms)
▶ A1 §91 override semantics
  ✔ SUBSTRATE_PROJECT grants access but doctor stays uninitialized; init still binds (449.548222ms)
✔ A1 §91 override semantics (453.73546ms)
▶ A1 §92 three-session Journal end-to-end (no chat history)
  ✔ A claims/finds/decides/milestones/checkpoints; B resumes/dispatches/results/receipts/closes; C reconstructs everything (866.157938ms)
✔ A1 §92 three-session Journal end-to-end (no chat history) (869.210229ms)
▶ A1 §93 coordinator capsule without child-transcript duplication
  ✔ root capsule recovers children by reference, never bodies (574.400082ms)
✔ A1 §93 coordinator capsule without child-transcript duplication (577.564108ms)
▶ A1 §94 Specialist provenance chain
  ✔ Repository -> Project -> rev/hash -> claim -> binding -> session/activation/attempt/AgentSession -> result -> receipt -> artifacts -> closure (317.000475ms)
✔ A1 §94 Specialist provenance chain (320.144029ms)
▶ A1 §95 zero-commit Issue completeness
  ✔ research with zero commits but findings/result/evidence/closure is complete (397.55656ms)
✔ A1 §95 zero-commit Issue completeness (400.851493ms)
▶ A1 §96 close-reason matrix and immutability
  ✔ completed/superseded/duplicate/cancelled persist refs; history immutable (728.965786ms)
✔ A1 §96 close-reason matrix and immutability (732.650798ms)
▶ A1 §97 automatic identity propagation and retry lineage
  ✔ xt session propagates; coordinator lineage preserved; retry keeps both attempts (65.108567ms)
✔ A1 §97 automatic identity propagation and retry lineage (68.250067ms)
▶ A1 §98 no fabricated provenance
  ✔ unknown stays absent/null, never invented (52.707131ms)
✔ A1 §98 no fabricated provenance (53.934875ms)
▶ A1 §102 final architectural invariant end to end
  ✔ Git repo -> init -> rev/hash -> readiness -> claim -> session -> activation/attempt -> journal -> receipt -> artifact -> validation -> closure -> reconstruct (546.229204ms)
✔ A1 §102 final architectural invariant end to end (548.673912ms)
▶ A1 §103 definition of complete (mechanical record)
  ✔ one-command init; uninitialized never sees others; worktrees/clones share; durable explain; resume without transcript; help/docs teach one model (298.745912ms)
✔ A1 §103 definition of complete (mechanical record) (303.860673ms)
▶ A1 negative-control guard: no global-cardinality shortcut
  ✔ resolveProject has no live projects.length===1 inference and no source single (5.627916ms)
  ✔ the guard rejects whitespace, receiver and comment variants (0.712536ms)
✔ A1 negative-control guard: no global-cardinality shortcut (6.552965ms)
ℹ tests 20
ℹ suites 18
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8058.700528
