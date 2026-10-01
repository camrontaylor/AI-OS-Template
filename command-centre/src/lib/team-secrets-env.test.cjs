const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const {
  TEAMOS_SECRETS_BEGIN,
  TEAMOS_SECRETS_END,
  cleanupManagedTeamSecrets,
  syncTeamSecretsToManagedEnv,
} = loadTsModule(path.resolve(__dirname, "team-secrets-env.ts"), {
  stubs: {
    "./local-profile": {
      resolveLocalProfileDescriptor: () => ({ mode: "solo" }),
    },
  },
});

test("logout removes managed secret blocks and matching in-memory variables", async () => {
  const root = await tempDir();
  const profile = {
    version: 1,
    mode: "team",
    profileKey: "profile-a",
    stateDir: path.join(root, "profile-state"),
  };
  const envPath = path.join(root, ".env");
  const metadataPath = path.join(profile.stateDir, "team-secrets-sync.json");
  const key = "AIOS_385_TEST_SECRET";
  try {
    await fs.mkdir(profile.stateDir, { recursive: true });
    await fs.writeFile(envPath, `LOCAL_ONLY=1\n\n${TEAMOS_SECRETS_BEGIN}\n${key}=fake\n${TEAMOS_SECRETS_END}\n`);
    await fs.writeFile(metadataPath, JSON.stringify({ version: 1, files: { [envPath]: { label: "Team", keys: [key], syncedAt: new Date().toISOString() } } }));
    process.env[key] = "fake";
    const result = await cleanupManagedTeamSecrets(root, profile);
    assert.equal(result.filesChanged, 1);
    assert.equal(await fs.readFile(envPath, "utf8"), "LOCAL_ONLY=1\n");
    assert.equal(process.env[key], undefined);
    await assert.rejects(fs.access(metadataPath));
  } finally {
    delete process.env[key];
    await rmDir(root);
  }
});

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "aios-secrets-env-"));
}

async function rmDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

test("managed env sync writes only the TeamOS block and protects user-owned values", async () => {
  const root = await tempDir();
  try {
    const rootEnv = path.join(root, ".env");
    const clientEnv = path.join(root, "clients", "acme", ".env");
    const initialRootEnv = "FIRECRAWL_API_KEY=user-owned\nLOCAL_ONLY=1\n";
    await fs.writeFile(rootEnv, initialRootEnv);

    const payload = {
      team: {
        secrets: [
          { id: "s1", name: "Firecrawl", envKey: "FIRECRAWL_API_KEY", value: "fake-team-value" },
        ],
      },
      clients: [
        {
          id: "c1",
          slug: "acme",
          name: "Acme",
          secrets: [
            { id: "s2", name: "Acme", envKey: "ACME_API_KEY", value: "fake-client-value" },
          ],
        },
      ],
    };

    const blocked = await syncTeamSecretsToManagedEnv(root, payload);
    assert.equal(blocked.filesChanged, 0);
    assert.deepEqual(blocked.conflicts.map((conflict) => conflict.keys), [["FIRECRAWL_API_KEY"]]);
    assert.equal(await fs.readFile(rootEnv, "utf-8"), initialRootEnv);

    const written = await syncTeamSecretsToManagedEnv(root, payload, { overwriteConflicts: true });
    assert.equal(written.filesChanged, 2);

    const rootContent = await fs.readFile(rootEnv, "utf-8");
    assert.match(rootContent, /LOCAL_ONLY=1/);
    assert.match(rootContent, new RegExp(TEAMOS_SECRETS_BEGIN));
    assert.match(rootContent, /FIRECRAWL_API_KEY=fake-team-value/);
    assert.match(rootContent, new RegExp(TEAMOS_SECRETS_END));
    assert.doesNotMatch(rootContent, /FIRECRAWL_API_KEY=user-owned/);

    const clientContent = await fs.readFile(clientEnv, "utf-8");
    assert.match(clientContent, /ACME_API_KEY=fake-client-value/);
    assert.match(clientContent, new RegExp(TEAMOS_SECRETS_BEGIN));

    const removed = await syncTeamSecretsToManagedEnv(root, { team: { secrets: [] }, clients: [] });
    assert.equal(removed.conflicts.length, 0);
    assert.ok(removed.filesChanged >= 2);
    assert.equal(await fs.readFile(rootEnv, "utf-8"), "LOCAL_ONLY=1\n");
    assert.equal(await fs.readFile(clientEnv, "utf-8"), "");
  } finally {
    await rmDir(root);
  }
});
