// CORE-2595 R1 regression: secrets are scrubbed before storage, and the
// finished index holds none of the seeded shapes. Every assertion here fails
// on the pre-recall code because the scrub module does not exist there.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SCRUB_RULE_IDS, SCRUB_VERSION, isHighEntropySecret, isSensitiveName, scanSecrets, scrubText } from "../src/recall/scrub.ts";
import { buildRecallIndex } from "../src/recall/indexer.ts";
import { recall } from "../src/recall/query.ts";
import { createFixtureStore } from "./recall-fixtures.ts";

interface SecretCase {
  label: string;
  text: string;
  secret: string;
}

const pem = (label: string): string => `${"-".repeat(5)}BEGIN ${label}${"-".repeat(5)}`;
const pemEnd = (label: string): string => `${"-".repeat(5)}END ${label}${"-".repeat(5)}`;

function hexSecretCase(label: string, secretHex: string, prefix: string, suffix: string): SecretCase {
  const secret = Buffer.from(secretHex, "hex").toString("utf8");
  return { label, secret, text: prefix + secret + suffix };
}

export const CASES: SecretCase[] = [
  hexSecretCase("Anthropic key", "736b2d616e742d61706930332d4131623243336434453566364737683849396a304b316c324d336e344f35703651377238", "the worker used ", ""),
  hexSecretCase("OpenAI key", "736b2d70726f6a2d5a7839597738567537547336527135506f344e6d334c6b324a6931486730466539446338426137", "OPENAI=", ""),
  hexSecretCase("GitHub ghp", "6768705f6142634465466748694a6b4c6d4e6f507152735475567758795a30313233343536373839", "token ", ""),
  hexSecretCase("GitHub gho", "67686f5f316132423363344435653646376738483969304a316b324c336d344e356f365037713852", "token ", ""),
  hexSecretCase("GitHub ghu", "6768755f395a3879375836773556347533543273315230713950386f374e366d354c346b334a32", "token ", ""),
  hexSecretCase("GitHub ghs", "6768735f513177324533723454357936553769384f3970304131733244336634473568364a376b38", "token ", ""),
  hexSecretCase("GitHub ghr", "6768725f5a3978384337763642356e344d336132533164304639673848376a364b356c3450336f32", "token ", ""),
  hexSecretCase("GitHub fine-grained PAT", "6769746875625f7061745f313141424344454647303132333435363738395f6162636465666768696a6b6c6d6e6f70", "token ", ""),
  hexSecretCase("Atlassian ATATT", "4154415454337846664746306142634465466748694a6b4c6d4e6f507152735475567758", "jira password ", ""),
  hexSecretCase("Atlassian ATBB", "415442426131423263334434653546366737483869394a306b314c326d334e346f3550", "oauth ", ""),
  hexSecretCase("AWS access key AKIA", "414b4941494f53464f444e4e374558414d504c45", "aws key ", ""),
  hexSecretCase("AWS access key ASIA", "41534941593334465a4b424f4b4d555456563741", "aws key ", ""),
  hexSecretCase("Bearer token", "6162636465666768696a6b6c6d6e6f707172737475767778797a30313233343536373839", "Authorization: Bearer ", ""),
  hexSecretCase("Basic auth", "64584e6c636a707759584e7a643239795a4445794d7a51314e673d3d", "Authorization: Basic ", ""),
  hexSecretCase("JWT", "65794a68624763694f694a49557a49314e694a392e65794a7a645749694f6949784d6a4d304e5459334f446b77496e302e646f7a6a674e727950344a336a566d4e486c3077354e5f58674c306e334939506c46555030544873523855", "session ", ""),
  hexSecretCase("Slack token", "786f78622d3132333435363738393031322d6162636465666768696a6b6c6d6e6f70", "slack ", ""),
  hexSecretCase("npm token", "6e706d5f6142634465466748694a6b4c6d4e6f507152735475567758795a30313233343536373839", "registry ", ""),
  hexSecretCase("PyPI token", "707970692d4167454963486c7761533576636d634162436445664768496a4b6c4d6e4f705172", "publish ", ""),
  hexSecretCase("Google API key", "41497a6153794131623243336434453566364737683849396a304b316c324d336e344f35703651", "maps ", ""),
  hexSecretCase("Stripe live key", "736b5f6c6976655f6142634465466748694a6b4c6d4e6f507152735475567758", "billing ", ""),
  hexSecretCase("GitLab token", "676c7061742d6142634465466748694a6b4c6d4e6f5071527354", "gitlab ", ""),
  hexSecretCase("SendGrid key", "53472e6142634465466748694a6b4c6d4e6f507152735475562e5778597a303132333435363738394162436445664768", "mail ", ""),
  hexSecretCase("Sentry DSN", "3031323334353637383961626364656630313233343536373839616263646566", "dsn https://", "@o123.ingest.sentry.io/456"),
  hexSecretCase("URL credentials", "5333637233745034737377307264", "db at https://admin:", "@db.example.com/x"),
  hexSecretCase("PEM private key", "4d4949456f77494241414b43415145413766616b6566616b6566616b6566616b6566616b6566616b65", `key file\n${pem("RSA PRIVATE KEY")}\n`, `\n${pemEnd("RSA PRIVATE KEY")}\nend`),
  hexSecretCase("PEM certificate", "4d494944617a4343416c4f67417749424167495566616b6566616b6566616b6566616b65", `cert\n${pem("CERTIFICATE")}\n`, `\n${pemEnd("CERTIFICATE")}\nend`),
  hexSecretCase("ANTHROPIC_API_KEY", "5a7839597738567537547336527135506f344e6d334c6b324a6931", "ANTHROPIC_API_KEY=", ""),
  hexSecretCase("MY_TOKEN", "3961423863374436653546346733483269314a306b394c386d374e36", "MY_TOKEN=", ""),
  hexSecretCase("DB_SECRET quoted", "73336372337456346c75653938373635343332317a7a7a", "DB_SECRET: \"", "\""),
  hexSecretCase("PASSWORD", "68756e7465723268756e7465723268756e74657232", "PASSWORD=", ""),
  hexSecretCase("CREDENTIALS", "61626364656631323334353637383930616263646566", "CREDENTIALS=", ""),
  hexSecretCase("apiKey camelCase", "3966386537643663356234613339323831373036663565346433633262316130", "apiKey: ", ""),
  hexSecretCase("sensitive word then entropy", "37516d325a70345872365476385962304e63314c64334866354a67374b6b39", "client key ", ""),
  hexSecretCase("GITHUB_TOKEN", "6142634465466748694a6b4c6d4e6f507152735475567758795a", "GITHUB_TOKEN=", ""),
  hexSecretCase("AWS_SECRET_ACCESS_KEY", "774a616c725855746e46454d492f4b374d44454e472f62507852666943594558414d504c454b4559", "AWS_SECRET_ACCESS_KEY=", ""),
  hexSecretCase("X-Api-Key", "6162636465663132333435363738393061626364656631323334", "X-Api-Key: ", ""),
  hexSecretCase("private_key", "4d494945765149424144414e42676b71686b6947397730424151454641415343", "private_key: ", ""),
  hexSecretCase("access_token", "6162636465666768696a6b6c6d6e6f707172737475767778797a30313233", "access_token = ", ""),
  hexSecretCase("passwd", "636f7272656374686f72736562617474657279737461706c65", "passwd: ", ""),
  hexSecretCase("ssh key entropy", "6233426c626e4e7a614331725a586b74646a45414141414142473576626d554141414145626d39755a51", "ssh key ", ""),
  hexSecretCase("Authorization Bearer", "5a7839597738567537547336527135506f344e6d334c6b324a69314867304665", "Authorization: Bearer ", ""),
];

describe("recall scrub: seeded secret shapes", () => {
  it("covers at least 30 distinct secret shapes", () => {
    assert.ok(CASES.length >= 30, `only ${CASES.length} cases`);
    assert.ok(SCRUB_RULE_IDS.length >= 15);
    assert.match(SCRUB_VERSION, /^scrub-[0-9a-f]{12}$/);
  });

  for (const testCase of CASES) {
    it(`scrubs and detects: ${testCase.label}`, () => {
      assert.ok(scanSecrets(testCase.text).length > 0, "scanner must see the seeded secret");
      const scrubbed = scrubText(testCase.text);
      assert.equal(scrubbed.text.includes(testCase.secret), false, "secret survived scrubbing");
      assert.equal(scanSecrets(scrubbed.text).length, 0, `scrubbed text still flagged: ${JSON.stringify(scanSecrets(scrubbed.text))}`);
    });
  }

  it("leaves ordinary text and names alone", () => {
    for (const text of [
      "keyword: performance",
      "monkey=banana",
      "The key insight is that caching helps",
      "task=complete status=ready",
      "the checkpoint key 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39 was recorded",
    ]) {
      assert.deepEqual(scanSecrets(text), [], `false positive on: ${text}`);
      assert.equal(scrubText(text).text, text);
    }
    assert.equal(scrubText("API_KEY=[REDACTED]").text, "API_KEY=[REDACTED]");
    assert.equal(scrubText("TOKEN=$GITHUB_TOKEN").text, "TOKEN=$GITHUB_TOKEN");
  });

  it("classifies names and entropy", () => {
    assert.equal(isSensitiveName("ANTHROPIC_API_KEY"), true);
    assert.equal(isSensitiveName("apiKey"), true);
    assert.equal(isSensitiveName("client-secret"), true);
    assert.equal(isSensitiveName("keyDecisions"), false);
    assert.equal(isSensitiveName("key_facts"), false);
    assert.equal(isSensitiveName("secrets_files"), false);
    assert.equal(isSensitiveName("keyboard"), false);
    assert.equal(isSensitiveName("monkey"), false);
    assert.equal(isHighEntropySecret("7Qm2Zp4Xr6Tv8Yb0Nc1Ld3Hf5Jg7Kk9"), true);
    assert.equal(isHighEntropySecret("3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39"), false);
    assert.equal(isHighEntropySecret("a".repeat(32)), false);
    // Real-index false positives: path fragment, lowercase slug, short token.
    assert.equal(isHighEntropySecret("apps/console/src/AnotherComponent"), false);
    assert.equal(isHighEntropySecret("beads-history-beads-note-a9gd"), false);
    assert.equal(isHighEntropySecret("0123456789abcdef01234567"), false);
  });
});

describe("recall scrub: the finished index holds no seeded secret", () => {
  const store = createFixtureStore(
    CASES.map((testCase, index) => ({
      ref: `CORE-${4000 + index}`,
      seq: 1,
      kind: "note",
      semantic: { summary: `fixture ${testCase.label}: ${testCase.text}` },
    })),
  );
  after(() => store.cleanup());

  it("indexes every row with the current scrub revision", () => {
    const build = buildRecallIndex({ storePath: store.storePath, indexPath: store.indexPath, loadGate: 0 });
    assert.equal(build.status, "built");
    assert.equal(build.docsTotal, CASES.length);
    const db = new DatabaseSync(store.indexPath, { readOnly: true });
    try {
      const state = db.prepare("SELECT scrub_version FROM index_state WHERE id = 1").get();
      assert.equal(state?.["scrub_version"], SCRUB_VERSION);
      const texts = db.prepare("SELECT body, title, head FROM docs").all();
      const joined = texts.map((row) => Object.values(row).join(" ")).join("\n");
      for (const testCase of CASES) assert.equal(joined.includes(testCase.secret), false, `stored text leaked ${testCase.label}`);
      assert.deepEqual(scanSecrets(joined), [], "stored index text still scans as secret-bearing");
    } finally {
      db.close();
    }
  });

  it("the index file bytes hold no seeded secret literal", () => {
    const bytes = readFileSync(store.indexPath);
    for (const testCase of CASES) {
      assert.equal(bytes.includes(Buffer.from(testCase.secret)), false, `index file leaked ${testCase.label}`);
    }
  });

  it("queries return scrubbed snippets only", () => {
    const result = recall({ terms: "fixture", indexPath: store.indexPath, limit: 50 });
    assert.ok(result.hits.length > 0);
    for (const hit of result.hits) {
      for (const testCase of CASES) assert.equal(hit.snippet.includes(testCase.secret), false);
    }
  });
});
