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
cannot dirty this evidence. Regenerate the committed set on purpose.

**After** — the current tree, in place:

```bash
cd packages/xtrm-app
XTRM_APP_PORT=5318 SCALE_SHOTS_DIR=docs/screenshots/ui-scale SCALE_PHASE=after \
  npx playwright test e2e/ui-scale.spec.ts -g "scale screenshots"
```

**Before** — the `cdb668b` sources, in a detached worktree so this tree is never touched. Two
details matter:

- the worktree must sit on the same filesystem as this checkout, because `node_modules` is
  hard-linked (`cp -al`) rather than symlinked. A symlink puts the Geist font files outside Vite's
  serving allow-list, the fonts fall back, and the captures no longer match the committed set.
  `/tmp` is usually a different filesystem, so use a directory beside the repository.
- `cdb668b` predates the spec, so copy the current spec into the worktree first.

```bash
cd packages/xtrm-app
here=$(pwd)
before=$HOME/.cache/xtrm-ui-scale-before
git worktree add --detach "$before" cdb668b
cp -al "$here/node_modules" "$before/packages/xtrm-app/node_modules"
cp -f e2e/ui-scale.spec.ts e2e/scale-capture.ts "$before/packages/xtrm-app/e2e/"
cd "$before/packages/xtrm-app"
XTRM_APP_PORT=5319 SCALE_SHOTS_DIR=docs/screenshots/ui-scale SCALE_PHASE=before \
  npx playwright test e2e/ui-scale.spec.ts -g "scale screenshots"
for shot in docs/screenshots/ui-scale/before-*.png; do cp -f "$shot" "$here/docs/screenshots/ui-scale/${shot##*/}"; done
cd "$here" && git worktree remove --force "$before"
```

This recipe reproduces the committed `before-*` set: at the 12px root and on the light toolbar the
comparison is pixel-identical, on the other two it is within 8.3e-8 of the image area.

Each capture must clear three checks before it is written into this directory (`e2e/scale-capture.ts`):
more than 4 kB, more than 16 distinct colours, and no single colour covering more than 98% of the
pixels. Size alone was too weak — the blank that reached review was 1797 bytes (XTRM-907).
