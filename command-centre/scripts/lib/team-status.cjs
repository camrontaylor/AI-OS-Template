function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function teamName(team) {
  return team?.name || team?.slug || team?.id || "Team OS";
}

function userName(user) {
  return user?.email || user?.id || "unknown user";
}

function pendingJobs(memoryBody) {
  return Object.entries(asRecord(memoryBody?.jobsByStatus))
    .filter(([key]) => ["queued", "indexing", "running"].includes(key))
    .reduce((total, [, value]) => total + Number(value || 0), 0);
}

function formatWhoamiLines(whoami) {
  return [
    `Signed in as: ${userName(whoami.user)}`,
    `Team: ${teamName(whoami.team)}`,
    `Role: ${whoami.membership?.role || "member"}`,
  ];
}

function formatDashboardLines(input) {
  const lines = [
    `Team: ${teamName(input.whoami?.team)}`,
    `Signed in as: ${userName(input.whoami?.user)}`,
    `Role: ${input.whoami?.membership?.role || "member"}`,
    `Clients: ${asArray(input.clients?.clients).length}`,
  ];
  if (input.skills) lines.push(`Skills: ${asArray(input.skills.skills).length}`);
  if (input.secrets) lines.push(`Secrets: ${asArray(input.secrets.secrets).length}`);
  if (input.memory) {
    lines.push(`Memory: ${input.memory.sources || 0} sources, ${input.memory.chunks || 0} chunks, ${pendingJobs(input.memory)} pending`);
  }
  const storage = asRecord(input.admin?.storage);
  if (storage.warning) lines.push(`Storage warning: ${storage.warning}`);
  if (storage.backup?.warning) lines.push(`Backup warning: ${storage.backup.warning}`);
  return lines;
}

module.exports = {
  formatDashboardLines,
  formatWhoamiLines,
  pendingJobs,
  teamName,
  userName,
};
