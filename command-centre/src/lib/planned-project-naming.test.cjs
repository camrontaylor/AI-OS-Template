const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const pureSourcePath = path.resolve(__dirname, "planned-project-naming.ts");
const serverSourcePath = path.resolve(__dirname, "planned-project-naming.server.ts");

function loadModule(sourcePath, stubs = {}) {
  const source = fs.readFileSync(sourcePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    if (request.startsWith("./") || request.startsWith("../")) {
      return require(path.resolve(path.dirname(sourcePath), request));
    }
    return require(request);
  };

  const compiled = new Function(
    "require",
    "module",
    "exports",
    "__dirname",
    "__filename",
    outputText,
  );
  compiled(localRequire, module, module.exports, path.dirname(sourcePath), sourcePath);
  return module.exports;
}

test("planned project naming uses explicit title without calling Haiku", async () => {
  const pure = loadModule(pureSourcePath);
  let calls = 0;
  const { resolvePlannedProjectName } = loadModule(serverSourcePath, {
    "@/lib/planned-project-naming": pure,
    "@/lib/run-claude-text-prompt": {
      runClaudeTextPrompt: async () => {
        calls += 1;
        return "Wrong Name";
      },
    },
  });

  const result = await resolvePlannedProjectName({
    userTitle: "AI Agent RAG",
    prompt: "Create a guide for an AI agent with RAG in n8n.",
  });

  assert.deepEqual(result, {
    name: "AI Agent RAG",
    slug: "ai-agent-rag",
    source: "title",
  });
  assert.equal(calls, 0);
});

test("planned project naming uses Haiku when title is empty", async () => {
  const pure = loadModule(pureSourcePath);
  const { resolvePlannedProjectName } = loadModule(serverSourcePath, {
    "@/lib/planned-project-naming": pure,
    "@/lib/run-claude-text-prompt": {
      runClaudeTextPrompt: async () => "AI Agent RAG\n",
    },
  });

  const result = await resolvePlannedProjectName({
    userTitle: "",
    prompt: [
      "Create an example so I can understand planned project behavior.",
      "- Project name: AI Agent RAG",
      "- Goal: create a simple HTML guide for a small business.",
    ].join("\n"),
  });

  assert.deepEqual(result, {
    name: "AI Agent RAG",
    slug: "ai-agent-rag",
    source: "ai",
  });
});

test("planned project naming falls back to prompt beginning when Haiku fails", async () => {
  const pure = loadModule(pureSourcePath);
  const { resolvePlannedProjectName } = loadModule(serverSourcePath, {
    "@/lib/planned-project-naming": pure,
    "@/lib/run-claude-text-prompt": {
      runClaudeTextPrompt: async () => null,
    },
  });

  const result = await resolvePlannedProjectName({
    userTitle: null,
    prompt: [
      "Create an example so I can understand planned project behavior.",
      "- Project name: AI Agent RAG",
    ].join("\n"),
  });

  assert.deepEqual(result, {
    name: "Create an example so I can understand planned project behavior.",
    slug: "create-an-example-so-i-can-understand-planned-project-behavi",
    source: "fallback",
  });
});
