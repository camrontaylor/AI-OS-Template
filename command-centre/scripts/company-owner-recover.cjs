#!/usr/bin/env node
/**
 * company-owner-recover — restore Company Ownership when no active Owner exists.
 *
 * Usage:
 *   node scripts/company-owner-recover.cjs --user <email|id>
 */

const {
  loadIdentityModules,
  openLocalIdentityStore,
  resolveUserRef,
} = require("./load-identity-modules.cjs");

const USAGE = `company-owner-recover — restore a missing Company Owner

Usage:
  node scripts/company-owner-recover.cjs --user <email|id>`;

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === "--user") flags.user = take();
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

async function recoverCompanyOwner({
  store,
  teamAuth,
  userRef,
  resolveUser = resolveUserRef,
}) {
  const user = await resolveUser(store, userRef);
  if (user.status !== "active") {
    throw new Error(`${user.email} is not an active user`);
  }
  if (!(await teamAuth.hasUsablePlatformCredential(store, user.email))) {
    throw new Error(
      `${user.email} does not have a usable platform account; choose a user who can already sign in`,
    );
  }
  const membership = await store.recoverCompanyOwner({ userId: user.id });
  return { membership, user };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!flags.user) {
    console.error("company-owner-recover: --user is required.\n");
    console.error(USAGE);
    return 2;
  }

  const { store, teamAuth } = loadIdentityModules();
  const identityStore = await openLocalIdentityStore(store);
  try {
    const result = await recoverCompanyOwner({
      store: identityStore,
      teamAuth,
      userRef: flags.user,
    });
    console.log("company-owner-recover → Company Owner restored");
    console.log(`  owner : ${result.user.email} (${result.user.id})`);
    return 0;
  } finally {
    await identityStore.close();
  }
}

module.exports = { parseArgs, recoverCompanyOwner };

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\ncompany-owner-recover failed: ${error instanceof Error ? error.message : error}`);
      if (error && error.stack) console.error(error.stack);
      console.error(`\n${USAGE}`);
      process.exit(1);
    });
}
