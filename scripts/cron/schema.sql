CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'queued', 'running', 'review', 'done')),
  level TEXT NOT NULL DEFAULT 'task' CHECK (level IN ('task', 'project', 'gsd')),
  parentId TEXT,
  columnOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  costUsd REAL,
  tokensUsed INTEGER,
  durationMs INTEGER,
  activityLabel TEXT,
  errorMessage TEXT,
  startedAt TEXT,
  completedAt TEXT,
  phaseNumber INTEGER,
  gsdStep TEXT CHECK (gsdStep IN ('discuss', 'plan', 'execute', 'verify')),
  claudePid INTEGER,
  permissionMode TEXT DEFAULT 'bypassPermissions',
  executionPermissionMode TEXT DEFAULT 'bypassPermissions',
  model TEXT,
  thinkingEffort TEXT CHECK (thinkingEffort IN ('auto', 'low', 'medium', 'high', 'xhigh', 'max')),
  dependsOnTaskIds TEXT,
  startSnapshot TEXT,
  FOREIGN KEY (parentId) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_parentId ON tasks(parentId);

CREATE TABLE IF NOT EXISTS task_outputs (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  fileName TEXT NOT NULL,
  filePath TEXT NOT NULL,
  relativePath TEXT NOT NULL,
  extension TEXT NOT NULL DEFAULT '',
  sizeBytes INTEGER,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_outputs_taskId ON task_outputs(taskId);

CREATE TABLE IF NOT EXISTS cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jobSlug TEXT NOT NULL,
  taskId TEXT,
  startedAt TEXT NOT NULL,
  completedAt TEXT,
  result TEXT NOT NULL DEFAULT 'running' CHECK (result IN ('success', 'failure', 'timeout', 'running')),
  resultSource TEXT CHECK (resultSource IN ('observed', 'inferred')),
  completionReason TEXT,
  durationSec REAL,
  costUsd REAL,
  exitCode INTEGER,
  trigger TEXT DEFAULT 'scheduled',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_jobSlug ON cron_runs(jobSlug);
CREATE INDEX IF NOT EXISTS idx_cron_runs_startedAt ON cron_runs(startedAt);

CREATE TABLE IF NOT EXISTS task_logs (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'tool_use', 'tool_result', 'question', 'structured_question', 'user_reply', 'system')),
  timestamp TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  toolName TEXT,
  toolArgs TEXT,
  toolResult TEXT,
  isCollapsed INTEGER DEFAULT 0,
  questionSpec TEXT,
  questionAnswers TEXT,
  FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_logs_taskId ON task_logs(taskId);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('permission')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  title TEXT NOT NULL,
  description TEXT,
  toolName TEXT NOT NULL,
  inputJson TEXT NOT NULL,
  decision TEXT,
  decisionMessage TEXT,
  createdAt TEXT NOT NULL,
  resolvedAt TEXT,
  FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_taskId ON approval_requests(taskId);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);

-- Autonomous mode: conversations between user and orchestrator
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  clientId TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);

-- Autonomous mode: messages in a conversation
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL,
  taskId TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'orchestrator', 'sub_agent', 'system')),
  content TEXT NOT NULL DEFAULT '',
  metadata TEXT,
  parentMessageId TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (parentMessageId) REFERENCES messages(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversationId ON messages(conversationId);
CREATE INDEX IF NOT EXISTS idx_messages_taskId ON messages(taskId);

-- Autonomous mode: orchestrator scoping decisions
CREATE TABLE IF NOT EXISTS agent_decisions (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL,
  messageId TEXT,
  decisionType TEXT NOT NULL CHECK (decisionType IN ('scope', 'decompose', 'delegate', 'clarify', 'complete_inline')),
  reasoning TEXT,
  taskIds TEXT,
  level TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_conversationId ON agent_decisions(conversationId);

-- First-class projects — tracks project status and links to tasks via slug
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'complete', 'archived')),
  level INTEGER NOT NULL DEFAULT 2,
  briefPath TEXT,
  goal TEXT,
  clientId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
