// XTRM-607 probe: hold before_agent_start for 6 s, like the slow handlers that widen the Pi startup window.
export default function startupDelay(pi: any): void {
  pi.on("before_agent_start", async () => {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.XTRM607_DELAY_MS ?? 6000)));
  });
}
