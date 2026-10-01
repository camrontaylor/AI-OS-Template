const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.resolve(__dirname, "run-claude-text-prompt.ts");

function loadModule(stubs = {}) {
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
    outputText
  );
  compiled(localRequire, module, module.exports, path.dirname(sourcePath), sourcePath);
  return module.exports;
}

function createFakeChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    ended: false,
    value: undefined,
    on() {
      return this;
    },
    end(value) {
      this.ended = true;
      this.value = value;
    },
  };
  return child;
}

test("runClaudeTextPrompt uses spawnUiProcess and returns trimmed stdout", async () => {
  const spawnCalls = [];
  const fakeChild = createFakeChildProcess();
  const { runClaudeTextPrompt } = loadModule({
    "@/lib/subprocess": {
      spawnUiProcess: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        setImmediate(() => {
          fakeChild.stdout.emit("data", Buffer.from("  grouped goals  \n"));
          fakeChild.emit("close", 0);
        });
        return fakeChild;
      },
      killChildProcessTree: () => {},
    },
  });

  const result = await runClaudeTextPrompt({
    prompt: "Cluster these tasks",
    model: "haiku",
    timeoutMs: 100,
  });

  assert.equal(result, "grouped goals");
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "claude");
  assert.deepEqual(spawnCalls[0].args, [
    "-p",
    "--output-format",
    "text",
    "--model",
    "haiku",
  ]);
  assert.equal(fakeChild.stdin.ended, true);
  assert.equal(fakeChild.stdin.value, "Cluster these tasks");
  assert.equal(spawnCalls[0].args.includes("Cluster these tasks"), false);
});

test("runClaudeTextPrompt kills the spawned process on timeout", async () => {
  const fakeChild = createFakeChildProcess();
  let killCalls = 0;
  const { runClaudeTextPrompt } = loadModule({
    "@/lib/subprocess": {
      spawnUiProcess: () => fakeChild,
      killChildProcessTree: () => {
        killCalls += 1;
      },
    },
  });

  const result = await runClaudeTextPrompt({
    prompt: "Retitle everything",
    timeoutMs: 20,
  });

  assert.equal(result, null);
  assert.equal(killCalls, 1);
});
