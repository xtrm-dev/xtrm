// Shared stdin reader for the plugin hook entry scripts (bead xtrm-iip.1).
// Claude Code delivers hook input as JSON on stdin. A TTY, empty input, or
// malformed JSON all yield {} so a hook never fails the lifecycle event it
// was attached to.

export function readHookInput() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve({});
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    const done = () => {
      if (data.trim() === "") return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    };
    process.stdin.on("end", done);
    process.stdin.on("error", done);
  });
}
