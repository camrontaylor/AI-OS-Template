const { confirm } = require("./team-prompts.cjs");

function conflictSummary(conflict) {
  const op = conflict.operation || "change";
  const path = conflict.path || "(unknown path)";
  const secret = conflict.secret ? " [secret]" : "";
  return `${op}: ${path}${secret}`;
}

function printConflicts(conflicts) {
  const rows = Array.isArray(conflicts) ? conflicts : [];
  if (rows.length === 0) return;
  console.log("Conflicts:");
  for (const conflict of rows.slice(0, 20)) {
    console.log(`  - ${conflictSummary(conflict)}`);
  }
  if (rows.length > 20) console.log(`  ...and ${rows.length - 20} more`);
}

async function confirmOverwriteAfterConflict(errorBody, question) {
  const conflicts = Array.isArray(errorBody?.conflicts) ? errorBody.conflicts : [];
  printConflicts(conflicts);
  return confirm(question || "Overwrite these conflicts?");
}

module.exports = {
  confirmOverwriteAfterConflict,
  conflictSummary,
  printConflicts,
};
