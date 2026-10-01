const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

const embedder = loadTsModule(path.resolve(__dirname, "embedder.ts"));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-embedder-"));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(file, content = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function unitVector(dim) {
  const vec = new Array(dim).fill(0);
  vec[0] = 1;
  return vec;
}

test("createEmbedder clears corrupt BGE-M3 cache and retries once", async () => {
  const cacheDir = tempDir();
  const modelDir = path.join(cacheDir, "Xenova", "bge-m3");
  const badModel = path.join(modelDir, "onnx", "model_quantized.onnx");
  const unrelatedModel = path.join(cacheDir, "Other", "model.bin");
  writeFile(badModel, "partial onnx");
  writeFile(unrelatedModel, "keep");

  const events = [];
  let factoryCalls = 0;
  const result = await embedder.createEmbedder({
    kind: "bge-m3",
    cacheDir,
    progress: (event) => events.push(event),
    bgeM3Factory: () => {
      const callNumber = ++factoryCalls;
      return {
        model: "bge-m3",
        dim: 1024,
        embed: async () => {
          if (callNumber === 1) {
            throw new Error(`Load model from ${badModel} failed:Protobuf parsing failed.`);
          }
          return [unitVector(1024)];
        },
      };
    },
  });

  try {
    assert.equal(result.model, "bge-m3");
    assert.equal(result.dim, 1024);
    assert.equal(factoryCalls, 2);
    assert.equal(fs.existsSync(modelDir), false);
    assert.equal(fs.readFileSync(unrelatedModel, "utf8"), "keep");
    assert.ok(events.some((event) => event.status === "cache-repair"));
  } finally {
    rmDir(cacheDir);
  }
});

test("createEmbedder does not clear cache for non-model-load failures", async () => {
  const cacheDir = tempDir();
  const modelDir = path.join(cacheDir, "Xenova", "bge-m3");
  const marker = path.join(modelDir, "config.json");
  writeFile(marker, "{}");

  let factoryCalls = 0;
  try {
    await assert.rejects(
      () => embedder.createEmbedder({
        kind: "bge-m3",
        cacheDir,
        bgeM3Factory: () => {
          factoryCalls += 1;
          return {
            model: "bge-m3",
            dim: 1024,
            embed: async () => {
              throw new Error("Cannot find package @huggingface/transformers");
            },
          };
        },
      }),
      /BGE-M3 embedder unavailable .*Cannot find package/,
    );

    assert.equal(factoryCalls, 1);
    assert.equal(fs.readFileSync(marker, "utf8"), "{}");
  } finally {
    rmDir(cacheDir);
  }
});
