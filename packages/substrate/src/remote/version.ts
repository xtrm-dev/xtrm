// Small version comparison for capability reporting. Not a general semver
// implementation: it compares numeric dot-segments and ignores suffixes.

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .split("-")[0]!
      .split(".")
      .map((part) => {
        const match = /^\d+/.exec(part);
        return match === null ? 0 : Number(match[0]);
      });
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}
