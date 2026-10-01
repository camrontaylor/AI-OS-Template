const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTsModule(filePath, options = {}) {
  const source = fs.readFileSync(filePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filePath,
  });

  const stubs = options.stubs || {};
  const module = { exports: {} };

  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }

    if (request.startsWith(".")) {
      const base = path.resolve(path.dirname(filePath), request);
      const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.cjs`,
        `${base}.mjs`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
        path.join(base, "index.js"),
      ];
      const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (resolved) {
        if (resolved.endsWith(".ts") || resolved.endsWith(".tsx")) {
          return loadTsModule(resolved, options);
        }
        return require(resolved);
      }
    }

    if (request.startsWith("@/")) {
      throw new Error(`Missing stub for ${request} while loading ${path.basename(filePath)}`);
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
  compiled(localRequire, module, module.exports, path.dirname(filePath), filePath);
  return module.exports;
}

module.exports = {
  loadTsModule,
};
