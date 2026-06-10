---
date_created: Monday, June 1st 2026, 5:50:05 pm
date_modified: Tuesday, June 2nd 2026, 1:35:00 pm
created: 2026-06-07T02:22
updated: 2026-06-09T01:35
---
> **Status 2026-06-02 — bridge-era note.** This note describes the current specialists bridge implementation, where `chain_id` is worktree-lineage/root-job derived. It is **not** the final substrate identity model. Substrate treats `chain_id` as an opaque correlation field; future bridge/substrate phases may make it a bd molecule id or `container_id`. Do not parse the shape in dashboards, telemetry, or alerts. See [[substrate/substrate_design_it]] §2.7/§2.8 and the forensic contract `docs/telemetry/forensic-event-contract.md`.

Today a “chain” is defined by worktree lineage, not by an explicit edge table between
 arbitrary jobs.

 Core fields on SupervisorStatus:

 ```ts
   reused_from_job_id?: string
   worktree_owner_job_id?: string
   chain_kind?: 'chain' | 'prep'
   chain_id?: string
   chain_root_job_id?: string
   chain_root_bead_id?: string
   epic_id?: string
 ```

 How it works:

 1. Root job creates/owns the worktree
     - Usually an edit-capable job, e.g. executor/debugger with --worktree or auto worktree.
     - It gets:
       ```ts
         chain_kind = 'chain'
         chain_id = <root_job_id>
         chain_root_job_id = <root_job_id>
         worktree_path = <path>
       ```
 2. Follow-up job reuses that workspace
     - Launched with:
       ```bash
         sp run reviewer --job <prior-job-id> --bead <review-bead>
       ```
     - New job records:
       ```ts
         reused_from_job_id = <explicit --job argument>
         worktree_owner_job_id = <transitive root owner>
         chain_id = <root owner job id>
         chain_root_job_id = <root owner job id>
       ```
 3. Transitive reuse is preserved
     - If job C reuses reviewer job B, and B reused executor job A:
       ```ts
         C.reused_from_job_id = B
         C.worktree_owner_job_id = A
         C.chain_id = A
         C.chain_root_job_id = A
       ```
     - So the chain root stays stable.
 4. sp ps reconstructs the tree
     - Grouping: all jobs with same worktree_owner_job_id / chain_id
     - Parent-child edges: reused_from_job_id
     - So:
       ```text
         executor A
           └ reviewer B
               └ validator C
       ```
 5. Prep jobs are not chain jobs
     - If a job has no worktree lineage:
       ```ts
         chain_kind = 'prep'
         chain_id = undefined
       ```
     - Examples: read-only explorer/researcher prep jobs.
 6. Epic membership is separate
     - epic_id groups multiple chains under an epic.
     - epic_chain_membership persists:
       ```ts
         chain_id
         epic_id
         chain_root_bead_id
         chain_root_job_id
       ```
     - Epic readiness then evaluates chains by chain_id.

 So the relationship between two jobs is primarily:

 ```ts
   child.reused_from_job_id === parent.id
 ```

 and the relationship of all jobs to the same chain is:

 ```ts
   job.chain_id === rootJob.id
   // or
   job.worktree_owner_job_id === rootJob.id
 ```

 In short: a chain is a worktree-rooted reuse lineage; reused_from_job_id gives the parent
 edge, worktree_owner_job_id/chain_id gives the shared chain identity.
