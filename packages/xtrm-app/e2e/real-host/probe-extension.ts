// Test-only Pi extension for the real-host write-path run (XTRM-597): one tool that asks the
// operator a ctx.ui.confirm question. The xtrm-agent-host extension proxies that dialog to the host
// as extension_ui_request, so the same question can be answered in the GUI or in the terminal.
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const probeConfirm = defineTool({
  name: "probe_confirm",
  label: "Probe confirm",
  description: "Asks the operator to allow the probe and returns the answer. Call it when asked to run the probe.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
    const allowed = await ctx.ui.confirm("Probe", "Allow the probe?", { signal });
    return { content: [{ type: "text", text: allowed ? "probe allowed" : "probe denied" }], details: { allowed } };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(probeConfirm);
}
