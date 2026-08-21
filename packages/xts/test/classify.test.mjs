import assert from "node:assert/strict";
import test from "node:test";
import { classifyCommand, DEFAULT_PATTERN_DESCRIPTIONS, isSafe } from "../src/safety/classify.mjs";

function assertDangerous(command, expectedPattern, options) {
  const result = classifyCommand(command, options);
  assert.equal(result.safe, false, `${command} should be dangerous`);
  assert.equal(result.pattern, expectedPattern, `${command} pattern`);
  assert.equal(typeof result.reason, "string");
  assert.ok(result.reason.length > 0);
}

function assertSafe(command, options) {
  const result = classifyCommand(command, options);
  assert.equal(result.safe, true, `${command} should be safe, got ${JSON.stringify(result)}`);
}

test("dangerous: rm -rf and variants", () => {
  assertDangerous("rm -rf build-cache/", "rm -rf");
  assertDangerous("rm -fr x", "rm -rf");
  assertDangerous("rm --recursive --force x", "rm -rf");
  assertDangerous("rm -Rfv /tmp/x", "rm -rf");
  assertDangerous("rm -r -f /tmp/x", "rm -rf");
  assertDangerous("sudo rm -rf /", "sudo"); // sudo itself is flagged, first match
});

test("dangerous: privileged command execution", () => {
  assertDangerous("sudo apt-get install x", "sudo");
  assertDangerous("doas x", "doas");
  assertDangerous("pkexec x", "pkexec");
  assertDangerous("sudo echo hi", "sudo");
});

test("dangerous: disk and filesystem operations", () => {
  assertDangerous("dd if=/dev/zero of=/dev/sda", "dd of=");
  assertDangerous("mkfs.ext4 /dev/sdb1", "mkfs");
  assertDangerous("mkfs -t ext4 /dev/sdb1", "mkfs");
  assertDangerous("wipefs -a /dev/sdb", "wipefs");
  assertDangerous("blkdiscard /dev/sdb", "blkdiscard");
  assertDangerous("fdisk /dev/sda", "fdisk");
  assertDangerous("parted /dev/sda", "parted");
});

test("dangerous: recursive permission changes", () => {
  assertDangerous("chmod -R 777 .", "chmod -R 777");
  assertDangerous("chmod -R 0777 .", "chmod -R 777");
  assertDangerous("chown -R root:root /", "chown -R");
  assertDangerous("chown --recursive root:root /", "chown -R");
});

test("dangerous: container escape flags", () => {
  assertDangerous("docker run --privileged -it ubuntu", "container");
  assertDangerous("podman run --network=host x", "container");
  assertDangerous("docker run --pid=host ubuntu", "container");
  assertDangerous("docker create --privileged x", "container");
  assertDangerous("docker run -v /:/host ubuntu", "container");
  assertDangerous("podman run -v /var/run/docker.sock:/var/run/docker.sock x", "container");
  assertDangerous("docker run --mount type=bind,source=/,target=/host x", "container");
  assertDangerous("docker run --ipc host x", "container");
});

test("dangerous: destructive git operations (XTS additions)", () => {
  assertDangerous("git push --force origin main", "git push --force");
  assertDangerous("git push -f", "git push --force");
  assertDangerous("git reset --hard HEAD", "git reset --hard");
  assertDangerous("git clean -fdx", "git clean -fdx");
  assertDangerous("git clean -fd", "git clean -fdx");
});

test("dangerous: chained and wrapped commands", () => {
  assertDangerous("true && rm -rf /tmp/x", "rm -rf");
  assertDangerous("echo a; sudo reboot", "sudo");
  assertDangerous("echo x | rm -rf /tmp/x", "rm -rf");
  assertDangerous("nohup rm -rf /tmp/x", "rm -rf");
  assertDangerous("eval rm -rf /tmp/x", "rm -rf");
  assertDangerous("env rm -rf /tmp/x", "rm -rf");
});

test("safe: benign commands", () => {
  assertSafe("ls");
  assertSafe("git status");
  assertSafe("git pull --rebase");
  assertSafe("npm test");
  assertSafe("mkdir -p /tmp/x");
  assertSafe("rm file.txt");
  assertSafe("rm -f file");
  assertSafe("chmod 755 file");
  assertSafe("git commit -m \"x\"");
  assertSafe("echo hi");
  assertSafe("curl -s https://example.com");
  assertSafe("docker ps");
  assertSafe("docker build -t x .");
  assertSafe("git push origin main");
  assertSafe("docker run -it ubuntu"); // no dangerous flag
  assertDangerous("dd if=/dev/zero of=/tmp/out.bin", "dd of="); // guardrails parity: any dd of= is flagged
});

test("safe: echo of a dangerous-looking string is safe", () => {
  assertSafe("echo rm -rf");
  assertSafe("echo 'rm -rf /'");
  assertSafe("git status && git pull");
});

test("extraPatterns are substring-matched", () => {
  const extraPatterns = [{ pattern: "dangerzone", description: "custom high-risk pattern" }];
  assertDangerous("run dangerzone now", "dangerzone", { extraPatterns });
  assertSafe("run dangerzone now"); // without the param it stays safe
});

test("default pattern descriptions map is exported and populated", () => {
  assert.equal(typeof DEFAULT_PATTERN_DESCRIPTIONS, "object");
  assert.equal(DEFAULT_PATTERN_DESCRIPTIONS["rm -rf"], "recursive force delete");
  assert.ok(Object.keys(DEFAULT_PATTERN_DESCRIPTIONS).length >= 15);
});

test("classifyCommand validates input", () => {
  assert.throws(() => classifyCommand(null), TypeError);
  assert.throws(() => classifyCommand(42), TypeError);
});

test("isSafe wrapper", () => {
  assert.equal(isSafe("ls"), true);
  assert.equal(isSafe("rm -rf /"), false);
});

test("empty and whitespace commands are safe", () => {
  assertSafe("");
  assertSafe("   ");
});

// --- Adversarial gate-hardening regressions (xtrm-nka.7.3) ---
// High-risk commands must be caught through common wrappers/path forms
// without parsing quoted literals as commands.

const BYPASS_CASES = [
  ["/bin/rm -rf /tmp/x", "path-qualified rm"],
  ["/usr/bin/rm -rf /tmp/x", "usr-path rm"],
  ["env FOO=1 rm -rf /tmp/x", "env + assignment"],
  ["FOO=1 rm -rf /tmp/x", "bare assignment"],
  ["env rm -rf /tmp/x", "env wrapper"],
  ["nohup rm -rf /tmp/x", "nohup wrapper"],
  ["eval rm -rf /tmp/x", "eval wrapper"],
  ["command rm -rf /tmp/x", "command wrapper"],
  ["bash -c \"rm -rf /tmp/x\"", "bash -c double-quoted"],
  ["sh -c 'rm -rf /tmp/x'", "sh -c single-quoted"],
  ["zsh -c \"rm -rf /tmp/x\"", "zsh -c"],
  ["git -C /repo reset --hard", "git -C hard reset"],
  ["git -C /repo push --force", "git -C force push"],
  ["git --git-dir=/x reset --hard", "git --git-dir hard reset"],
  ["xargs rm -rf", "xargs rm"],
  ["find / -exec rm -rf {} +", "find -exec rm"],
];

test("gate hardening: wrapper/path bypasses are detected", () => {
  for (const [cmd, label] of BYPASS_CASES) {
    assert.equal(isSafe(cmd), false, `${label}: ${cmd} must be dangerous`);
  }
});

test("gate hardening: additional wrappers and nested forms are detected", () => {
  const dangerous = [
    ["env -i FOO=1 /bin/rm -rf /tmp/x", "env options + path rm"],
    ["env -- /bin/rm -rf /tmp/x", "env delimiter + path rm"],
    ["env /bin/sh -c 'FOO=1 /bin/rm -rf /tmp/x'", "env shell -c"],
    ["/bin/bash -c 'echo ok; /bin/rm -rf /tmp/x'", "path shell -c"],
    ["git -C/repo reset --hard", "attached git -C hard reset"],
    ["git -C /repo -c core.autocrlf=false push --force", "git global options"],
    ["xargs -0 -n1 /bin/rm -rf", "xargs options + path rm"],
    ["xargs -0 /bin/sh -c 'rm -rf /tmp/x'", "xargs shell -c"],
    ["kill -9 1234", "forced process termination"],
    ["pkill -9 node", "process-wide termination"],
    ["killall node", "process-wide termination"],
  ];
  for (const [cmd, label] of dangerous) {
    assert.equal(isSafe(cmd), false, `${label}: ${cmd} must be dangerous`);
  }
});

test("gate hardening: shell syntax in quoted literals is not executable", () => {
  const benign = [
    "echo \"rm -rf /tmp/x\"",
    "echo 'literal; rm -rf /tmp/x'",
    "printf '%s' \"git reset --hard\"",
    "printf '%s' '$(rm -rf /tmp/x)'",
    "git commit -m 'run git clean -fdx later'",
    "xargs echo 'rm -rf /tmp/x'",
  ];
  for (const cmd of benign) {
    assert.equal(isSafe(cmd), true, `${cmd} must be safe`);
  }
});

test("gate hardening: benign equivalents stay safe", () => {
  const benign = [
    "echo \"rm -rf\"",
    "printf 'rm -rf %s' /tmp",
    "git status",
    "git -C /repo status",
    "git push origin main",
    "git reset HEAD~1",
    "ls -la",
    "npm test",
    "env FOO=1 echo hi",
    "nohup git push origin main",
    "xargs echo",
    "bash -c \"echo safe\"",
    "kill 1234",
    "pkill -HUP my-service",
  ];
  for (const cmd of benign) {
    assert.equal(isSafe(cmd), true, `${cmd} must be safe`);
  }
});
