const ESCAPE = "\u001b";
const BELL = "\u0007";

export function writeClipboard(text, options = {}) {
  const { stream, isTmux = Boolean(process.env.TMUX) } = options;
  if (!stream?.isTTY || typeof stream.write !== "function") {
    const error = new Error("clipboard copy requires a TTY control stream");
    error.code = "XT_NO_TTY";
    throw error;
  }

  const osc52 = `${ESCAPE}]52;c;${Buffer.from(text).toString("base64")}${BELL}`;
  stream.write(isTmux ? `${ESCAPE}Ptmux;${ESCAPE}${osc52}${ESCAPE}\\` : osc52);
  return isTmux ? "tmux OSC 52" : "OSC 52";
}
