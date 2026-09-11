# XTRM App — Conar + DeepSeek Harness audit scope

**Status:** research brief  
**Consumer:** `packages/xtrm-app/docs/adoption-audit.md` and `xtrm-gui-prd.md`

## Purpose

Run a current-source audit before making additional commodity UI/runtime decisions for Console v2.

This brief does not authorize copying or vendoring source. Every candidate must be classified as `DEPEND`, `ADAPT`, `REFERENCE`, or `REJECT` with exact repository/ref/license evidence.

## Conar

Repository: `wannabespace/conar`.

Primary interest is UI craftsmanship and shell hierarchy:

- persistent global icon rail;
- contextual collapsible sidebar;
- menu hierarchy and density;
- icon family, size and selected/hover/focus states;
- buttons, menus, popovers, tooltips, command/search/autocomplete;
- list and row primitives;
- panels/dialogs/sheets;
- light/dark surface hierarchy;
- spacing and typography;
- keyboard navigation/hotkeys;
- motion/panel transitions;
- virtualization;
- underlying permissively licensed dependencies.

Conar's own source is not automatically adoptable. Treat it as reference unless the license gate explicitly allows a bounded reuse. Prefer direct dependencies on permissive underlying libraries where suitable.

The key shell hypothesis to evaluate is:

```text
persistent global icon rail
+ contextual collapsible sidebar
+ main work surface
+ inspector rail / drawer
```

The contextual sidebar should collapse into a narrow reopen rail, not disappear and not become a second icon menu. The global rail remains persistent.

## DeepSeek Harness

Repository: `deepseek-ai/deepseek-harness`.

Primary interest is future Agent and observability compatibility, not immediate full implementation:

- Agent registry and durable identity;
- create/resume/dispose lifecycle;
- parent/fork lineage;
- durable SessionEvent log;
- live agent event stream;
- durable-vs-live separation;
- projection architecture;
- tool-call lifecycle and streaming;
- cancellation/followup/steer/inject;
- Agent Teams roster and mailbox;
- runtime status/liveness;
- logs and telemetry;
- Web UI/desktop architecture.

Do not import its team task board as XTRM work authority. Substrate Issues remains executable-work authority. Do not replace Pi/provider transcript authority with a second transcript store.

## Required output

Return:

1. exact SHAs and licenses;
2. primitive/adoption matrix for Conar;
3. architecture/adoption matrix for DeepSeek Harness;
4. explicit dependencies worth consuming directly;
5. code/patterns suitable only for independent reimplementation;
6. risks from licensing, state ownership, runtime duplication or product-identity leakage;
7. exact proposed amendments to `adoption-audit.md` and `xtrm-gui-prd.md`.
