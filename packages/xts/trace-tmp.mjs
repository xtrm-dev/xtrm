process.env.XTS_CONFIG_DIR = "/tmp/xts-empty-config";
import("./src/cli.mjs").catch(e => { console.error("import err:", e.message); process.exit(2); });
// simulate: run the oneShot path with no stdin
const { readStdin } = await import("./src/stdin.mjs");
console.log("isTTY:", process.stdin.isTTY, "readableLength:", process.stdin.readableLength, "readableEnded:", process.stdin.readableEnded);
// Don't call cli's run — instead check what keeps the loop alive after the error path
