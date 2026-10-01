const { loadMemoryModules } = require("../load-memory-modules.cjs");

const TEAM_OS_EMBEDDING_MODEL = "bge-m3";
const TEAM_OS_EMBEDDING_DIM = 1024;
const DEFAULT_EMBED_BATCH_SIZE = 32;

let loadedModules = null;
let embedderPromise = null;

function modules() {
  if (!loadedModules) {
    loadedModules = loadMemoryModules({ withCapture: false });
  }
  return loadedModules;
}

function embedderKind() {
  return process.env.TEAM_OS_MEMORY_TEST_EMBEDDER === "hash"
    ? "hash"
    : TEAM_OS_EMBEDDING_MODEL;
}

function asTeamOsEmbeddingContract(emb) {
  if (process.env.TEAM_OS_MEMORY_TEST_EMBEDDER !== "hash") return emb;
  return {
    model: TEAM_OS_EMBEDDING_MODEL,
    dim: TEAM_OS_EMBEDDING_DIM,
    embed: (texts) => emb.embed(texts),
  };
}

async function teamOsEmbedder() {
  if (!embedderPromise) {
    const { embedder } = modules();
    embedderPromise = embedder.createEmbedder({ kind: embedderKind() })
      .then((emb) => {
        const testHash = process.env.TEAM_OS_MEMORY_TEST_EMBEDDER === "hash";
        if (testHash) return asTeamOsEmbeddingContract(emb);
        if (emb.model !== TEAM_OS_EMBEDDING_MODEL || emb.dim !== TEAM_OS_EMBEDDING_DIM) {
          throw new Error(
            `Team OS memory requires ${TEAM_OS_EMBEDDING_MODEL}/${TEAM_OS_EMBEDDING_DIM} embeddings`,
          );
        }
        return emb;
      });
  }
  return embedderPromise;
}

async function embedTexts(texts, batchSize = DEFAULT_EMBED_BATCH_SIZE) {
  const emb = await teamOsEmbedder();
  const out = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    out.push(...await emb.embed(texts.slice(start, start + batchSize)));
  }
  return out;
}

async function prepareMemoryApiSearchBody(query) {
  const emb = await teamOsEmbedder();
  const [queryEmbedding] = await emb.embed([query]);
  return {
    queryEmbedding,
    embeddingModel: emb.model,
    embeddingDim: emb.dim,
  };
}

async function prepareMemoryApiIngestBody(input) {
  const content = String(input.content ?? "");
  const sourcePath = String(input.sourcePath ?? "").trim();
  if (!sourcePath) throw new Error("sourcePath is required to prepare memory API ingest");

  const { chunker, ingest } = modules();
  const emb = await teamOsEmbedder();
  const rawChunks = chunker.chunkMarkdown(content);
  if (rawChunks.length === 0) {
    throw new Error("memory content produced no chunks");
  }
  const embeddings = await embedTexts(rawChunks.map((chunk) => chunk.content));
  const chunks = rawChunks.map((chunk, index) => ({
    index: chunk.index,
    content: chunk.content,
    heading: chunk.heading,
    headingLevel: chunk.headingLevel,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    contentHash: chunk.contentHash,
    chunkKey: ingest.buildChunkKey({
      sourcePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      contentHash: chunk.contentHash,
      embeddingModel: emb.model,
    }),
    tokenCount: chunk.tokenCount,
    embedding: embeddings[index],
  }));

  return {
    contentSha256: ingest.sha256Hex(content),
    byteSize: Buffer.byteLength(content, "utf-8"),
    embeddingModel: emb.model,
    embeddingDim: emb.dim,
    chunks,
  };
}

module.exports = {
  TEAM_OS_EMBEDDING_DIM,
  TEAM_OS_EMBEDDING_MODEL,
  prepareMemoryApiIngestBody,
  prepareMemoryApiSearchBody,
};
