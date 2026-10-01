const tableCache = new WeakMap();

async function openMemoryTestStore(storeModule, opts = {}) {
  return storeModule.openMemoryStore({ embedDim: opts.embedDim });
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function resetMemoryTestStore(memStore) {
  let tables = tableCache.get(memStore.client);
  if (!tables) {
    const { rows } = await memStore.client.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name <> 'schema_migrations'
        ORDER BY table_name`,
    );
    tables = rows.map((row) => String(row.table_name));
    tableCache.set(memStore.client, tables);
  }

  if (tables.length === 0) return;
  await memStore.client.exec(
    `TRUNCATE TABLE ${tables.map(quoteIdent).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

module.exports = {
  openMemoryTestStore,
  resetMemoryTestStore,
};
