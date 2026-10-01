async function readJsonResponse(response) {
  return response.json().catch(() => ({}));
}

async function teamRequest(config, pathName, options = {}) {
  if (process.env.AI_OS_TEAM_ENRICHMENT === "conversation_only") {
    const error = new Error("This existing chat is continuing without Team OS enrichment.");
    error.status = 403;
    error.code = "team_enrichment_disabled";
    throw error;
  }
  const headers = { authorization: `Bearer ${config.token}` };
  const processWorkMode = process.env.AI_OS_WORK_MODE;
  const teamId = Object.prototype.hasOwnProperty.call(options, "teamId")
    ? options.teamId
    : processWorkMode === "solo"
      ? null
      : process.env.AI_OS_TEAM_ID || config.selectedTeamId || config.team?.id || null;
  if (teamId) headers["x-ai-team-id"] = teamId;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${config.apiUrl}${pathName}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const body = await readJsonResponse(response);
  if (!response.ok) {
    const message = body?.error?.message || body?.error || `request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = body?.error?.code;
    error.body = body;
    throw error;
  }
  return body;
}

async function loginRequest(apiUrl, body) {
  const response = await fetch(`${apiUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await readJsonResponse(response);
  if (!response.ok) {
    const message = json?.error?.message || json?.error || `login failed (${response.status})`;
    throw new Error(message);
  }
  return json;
}

function queryString(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function fileQuery(filePath, extra = {}) {
  return queryString({ path: filePath, ...extra });
}

module.exports = {
  fileQuery,
  loginRequest,
  queryString,
  teamRequest,
};
