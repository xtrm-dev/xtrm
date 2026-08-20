// XTS dangerous-command approval overlay (task xtrm-nka.6).
//
// Contract with safety/approve.mjs (task xtrm-nka.5):
//   ctx.askApprove({ command, reason }) => Promise<boolean>
//
// The overlay is the only way to approve: Enter approves once, Esc (or any
// other key) denies. Deny-by-default matches the task-5 contract ("anything
// other than an explicit yes" is a deny).

import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const FG = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const BOLD = FG("1");
const DIM = FG("2");
const RED_BOLD = FG("1;31");

/**
 * Modal overlay asking the user to approve one dangerous command.
 * Renders a bordered box: title, command, reason, key hints.
 * Enter -> approve (true). Any other key -> deny (false).
 */
export class ApprovalOverlay {
  constructor({ command, reason, onResult }) {
    this.command = command;
    this.reason = String(reason ?? "").replace(/\s+/g, " ").trim();
    this.onResult = onResult;
  }

  handleInput(data) {
    if (matchesKey(data, Key.enter)) {
      this.finish(true);
    } else {
      this.finish(false);
    }
  }

  finish(ok) {
    if (!this.onResult) return;
    const cb = this.onResult;
    this.onResult = null;
    cb(ok);
  }

  invalidate() {}

  render(width) {
    const inner = Math.max(1, width - 4);
    const lines = [];
    const body = (text, style = (s) => s) => {
      for (const wrapped of wrapTextWithAnsi(text, inner)) {
        lines.push(`│ ${style(wrapped.padEnd(inner))} │`);
      }
    };

    const title = RED_BOLD("dangerous command");
    const titleFill = Math.max(0, width - 3 - visibleWidth(title));
    lines.push(`╭─${title}${"─".repeat(titleFill)}╮`);
    lines.push(`│${" ".repeat(width - 2)}│`);
    body("This command is potentially dangerous:", BOLD);
    lines.push(`│${" ".repeat(width - 2)}│`);
    body(truncateToWidth(`$ ${this.command}`, inner, "…"));
    if (this.reason) {
      lines.push(`│${" ".repeat(width - 2)}│`);
      body(`Reason: ${this.reason}`);
    }
    lines.push(`│${" ".repeat(width - 2)}│`);
    body("The command was NOT executed.", DIM);
    lines.push(`│${" ".repeat(width - 2)}│`);
    body("[Enter] approve once    [Esc] cancel", DIM);
    lines.push(`│${" ".repeat(width - 2)}│`);
    lines.push(`╰${"─".repeat(width - 2)}╯`);
    return lines;
  }
}

/**
 * Show the approval overlay on a running TUI and resolve with the decision.
 * Hides the overlay and restores focus when the user decides.
 *
 * @param {object} opts
 * @param {import("@earendil-works/pi-tui").TUI} opts.tui
 * @param {string} opts.command
 * @param {string} [opts.reason]
 * @returns {Promise<boolean>} true = approved
 */
export function showApprovalOverlay({ tui, command, reason }) {
  return new Promise((resolve) => {
    const overlay = new ApprovalOverlay({
      command,
      reason,
      onResult: (ok) => {
        tui.hideOverlay();
        resolve(ok);
      },
    });
    tui.showOverlay(overlay, { width: "70%", minWidth: 44, maxHeight: "80%", anchor: "center" });
  });
}

/**
 * Build the `askApprove` function that safety/approve.mjs's ctx expects:
 *   async ({ command, reason }) => boolean
 * Returns a deny-always handler when `app` has no requestApproval.
 */
export function makeTuiApprovalHandler(app) {
  return async ({ command, reason }) => {
    if (!app || typeof app.requestApproval !== "function") return false;
    return app.requestApproval({ command, reason });
  };
}
