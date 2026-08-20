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
