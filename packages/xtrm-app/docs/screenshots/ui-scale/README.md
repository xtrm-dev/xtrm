# UI scale evidence (XTRM-897, XTRM-907)

Eight screenshots: the sidebar and the Issues toolbar, light and dark, at a 16px root font size (the
default browser setting) and at the operator's 12px root, which is where the scale defects showed.

- `before-*` — the pre-XTRM-897 tree (`cdb668b`): sub-section labels were a hard-coded `text-[13px]`,
  section headers `text-[11px]`, toolbar glyphs 16px.
- `after-*` — the current tree: every label names a text token, every glyph an `ICON_REM` step.

Read the pair at `root12`: in `before-*` the section header (11px literal) is the largest text in
the sidebar and the sub-section labels (13px literal) are larger than their parent rows; in
`after-*` the header is 8.64px, the rows and their children 9.75px.

The spec writes to its own output directory (`e2e/.results`, gitignored), so a routine test run
cannot dirty this evidence. Regenerate the committed set on purpose:

```bash
cd packages/xtrm-app

# after: the current tree
XTRM_APP_PORT=5318 SCALE_SHOTS_DIR=docs/screenshots/ui-scale SCALE_PHASE=after \
  npx playwright test e2e/ui-scale.spec.ts -g "scale screenshots"

# before: the pre-XTRM-897 sources (stash your work first, restore with `git checkout HEAD -- src/`
# and then `git stash pop`)
git checkout cdb668b -- src/
XTRM_APP_PORT=5318 SCALE_SHOTS_DIR=docs/screenshots/ui-scale SCALE_PHASE=before \
  npx playwright test e2e/ui-scale.spec.ts -g "scale screenshots"
git checkout HEAD -- src/
```

Each capture is checked for size, so an empty file cannot be committed again (XTRM-907: one
committed capture was a 1.8 kB blank).
