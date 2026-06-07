# Vault workflow

> How to use this repo's `docs/` folder as an Obsidian vault, synced across machines via git only (no Syncthing).

## What you get

- Every edit you save in Obsidian becomes a git commit (after a short interval), pushed to `xtrm-dev/xtrm` on GitHub.
- Other machines pull and see the changes within minutes.
- Full diff history per note, browseable on GitHub or inside Obsidian itself.
- No Syncthing for this vault → no more `*.sync-conflict-*` files.

## First-time setup (per machine)

### 1. Clone the repo

```sh
mkdir -p ~/dev
git clone git@github.com:xtrm-dev/xtrm.git ~/dev/xtrm
```

Path can be anything — just use the same on every machine for habit consistency.

### 2. Open the vault in Obsidian

```
File → Open folder as vault → ~/dev/xtrm/docs
```

Open `docs/`, not the repo root — keeps `packages/`, `apps/`, `.github/` etc. out of the file explorer.

### 3. Trust the vault

The repo ships a pre-configured `.obsidian/` (35 plugins, themes, hotkeys, snippets baseline). On first open Obsidian shows:

> **Trust author and enable plugins?**

Click **Trust author and enable plugins**. All plugins activate as configured.

If you'd rather start clean, click **Don't trust** — Obsidian will use defaults and you'll install/enable plugins manually.

### 4. (Optional) Tune the obsidian-git plugin

Plugin is pre-installed and pre-enabled. Defaults baked in: vault backup every 10 min, auto pull every 10 min, push on backup, pull on startup, commit message `vault: {{date}}` (`YYYY-MM-DD HH:mm:ss`).

If you want to change them: `Settings → Git`.

| Setting | Suggested value |
|---|---|
| Vault backup interval (minutes) | `10` |
| Auto pull interval (minutes) | `10` |
| Push on backup | ON |
| Pull updates on startup | ON |
| Commit message | `vault: {{date}}` |
| Date placeholder format | `YYYY-MM-DD HH:mm:ss` |
| Disable push | OFF |

Lower intervals = more responsive, more commits.

### 5. SSH key (or token) on the machine

The plugin uses your machine's git config. If you can already `git push` from terminal in `~/dev/xtrm`, the plugin will too. On a fresh machine you may need to add an SSH key to GitHub first.

On mobile (iOS/Android), the plugin needs a **GitHub Personal Access Token** (not SSH). Generate one at https://github.com/settings/tokens with `repo` scope.

## Daily workflow

You don't run any git commands. You just edit notes in Obsidian.

What happens behind the scenes:

```
You save note.md in Obsidian
   ↓
(up to 10 min later)
Plugin commits: "vault: 2026-06-07 23:45:12"
Plugin pushes to xtrm-dev/xtrm
   ↓
Other machine (every 10 min)
Plugin pulls → note.md updated locally
```

If you want an immediate sync (e.g. you're switching machine now), open the command palette in Obsidian:

- `Git: Commit all changes` (or `Cmd+P` → type "git commit")
- `Git: Push`
- On the other machine: `Git: Pull`

## Conflicts

If you edit the same note on two machines without syncing in between, the next push fails. The plugin shows a conflict notice. You have three options:

1. **Open command palette → Git: Resolve conflicts** — opens a side-by-side view inside Obsidian.
2. **Drop to terminal** → `cd ~/dev/xtrm && git status` → resolve normally.
3. **Brutalize** — pick one machine's version with `git checkout --theirs <file>` or `--ours <file>`, then `git add`, `git commit`, push.

Practical mitigation: pause for a minute before switching machines, or trigger a manual `Git: Commit all changes + Push` when you stop editing.

## Branching for big edits

For drafty / structural changes, branch:

```sh
cd ~/dev/xtrm
git checkout -b docs/KAN-94-restructure
# edit in Obsidian — the plugin still auto-commits but on this branch
git push -u origin docs/KAN-94-restructure
gh pr create
```

For day-to-day note-taking, just stay on `main`. The plugin will commit/push there directly.

> Note: branch protection on `main` requires PRs **for non-admins**. As repo admin you can push directly to `main`. When collaborators arrive, you may want to switch this vault to a `notes/` branch and PR-promote curated notes to `main`. Decide later.

## What about Syncthing?

This repo is **not** Syncthing'd. Keep Syncthing only for `~/second-mind/` (your personal vault with `devjournal.md`, WIP, exploratory notes). When something matures from your personal vault into shared knowledge, manually copy it into `~/dev/xtrm/docs/` and let the plugin commit it.

The two vaults serve different purposes:

| Vault | Sync | Purpose |
|---|---|---|
| `~/second-mind/` | Syncthing | Personal, WIP, drafts, journal |
| `~/dev/xtrm/docs/` | git (obsidian-git) | Canonical xtrm knowledge, shared with collaborators |

## Plugin doc

- Repo: https://github.com/Vinzent03/obsidian-git
- Settings reference: https://publish.obsidian.md/git-doc/Start+here

## Recovery

If a machine's `.git/` gets corrupted or you want a fresh start:

```sh
mv ~/dev/xtrm ~/dev/xtrm.broken
git clone git@github.com:xtrm-dev/xtrm.git ~/dev/xtrm
# in Obsidian: vault path stays the same, plugin re-attaches automatically
rm -rf ~/dev/xtrm.broken
```

You can't lose notes this way — everything is on GitHub.
