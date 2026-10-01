const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const clientSlug = loadTsModule(path.resolve(__dirname, "client-slug.ts"));

test("suggestClientSlug creates a stable filesystem-safe suggestion", () => {
  assert.equal(clientSlug.suggestClientSlug("  Café & Company  "), "cafe-company");
  assert.equal(clientSlug.suggestClientSlug("___"), "client");
  assert.equal(
    clientSlug.suggestClientSlug("A".repeat(80)).length,
    clientSlug.CLIENT_SLUG_MAX_LENGTH,
  );
  assert.equal(
    clientSlug.suggestClientSlug("A".repeat(80), 999).length,
    clientSlug.CLIENT_SLUG_MAX_LENGTH,
  );
  assert.equal(clientSlug.suggestClientSlug("Root"), "root-2");
  assert.equal(clientSlug.suggestClientSlug("Root", 2), "root-3");
  assert.equal(clientSlug.suggestClientSlug("CON"), "con-2");
  assert.equal(clientSlug.suggestClientSlug("COM1"), "com1-2");
  assert.equal(clientSlug.suggestClientSlug("Acme", 2), "acme-2");
});

test("client slug normalization and validation are shared creation rules", () => {
  assert.equal(clientSlug.normalizeClientSlug("  Acme.Client  "), "acme.client");
  assert.equal(clientSlug.clientSlugValidationError("Acme.Client"), null);
  assert.match(clientSlug.clientSlugValidationError("root"), /reserved/i);
  assert.match(clientSlug.clientSlugValidationError("client/name"), /letters, numbers/i);
  assert.match(clientSlug.clientSlugValidationError(""), /required/i);
  assert.match(clientSlug.clientSlugValidationError("con"), /Windows/i);
  assert.match(clientSlug.clientSlugValidationError("AUX.txt"), /Windows/i);
  assert.match(clientSlug.clientSlugValidationError("client."), /end with a dot/i);
  assert.match(
    clientSlug.clientSlugValidationError("a".repeat(clientSlug.CLIENT_SLUG_MAX_LENGTH + 1)),
    /characters or fewer/i,
  );
  assert.equal(clientSlug.normalizeClientSlug(" client-with-space "), "client-with-space");
});
