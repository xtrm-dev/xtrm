// ShellContext envelope assembly (PRD §9.1). Thin re-export so prompt.mjs
// (task 4) imports one module for the model-prompt envelope without pulling
// in the history internals.
export { formatShellContext, loadShellContext } from "./history/shell.mjs";
