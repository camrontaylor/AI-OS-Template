"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  unstable_doesMiddlewareMatch,
} = require("next/dist/experimental/testing/server/middleware-testing-utils.js");

const { loadTsModule } = require("./lib/test-utils/load-ts-module.cjs");

class LocalProfileLockedError extends Error {}
class LocalProfileRequestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function loadProxy(assertRequest) {
  return loadTsModule(path.join(__dirname, "proxy.ts"), {
    stubs: {
      "@/lib/local-profile": {
        LocalProfileLockedError,
        localProfileErrorBody: () => ({ error: { code: "profile_locked" } }),
        resolveLocalProfileDescriptor: () => ({ version: 1, mode: "team", profileKey: "profile-a" }),
      },
      "@/lib/local-profile-lifecycle": {
        assertLocalProfileRequest: assertRequest,
        LocalProfileRequestError,
        localProfileRequestErrorBody: (error) => ({ error: { code: error.code } }),
      },
    },
  });
}

function request(pathname, method = "GET") {
  return { nextUrl: { pathname }, method, headers: new Headers() };
}

test("proxy permits only unauthenticated login/status recovery requests", () => {
  let checks = 0;
  const proxy = loadProxy(() => { checks += 1; });
  proxy.proxy(request("/api/team/session", "POST"));
  proxy.proxy(request("/api/team/status"));
  proxy.proxy(request("/api/team/session", "DELETE"));
  assert.equal(checks, 1);
});

test("proxy returns safe stale-session and profile-closing errors before routes run", async () => {
  let error = new LocalProfileRequestError(409, "stale_profile_session");
  const proxy = loadProxy(() => { throw error; });
  let response = proxy.proxy(request("/api/tasks"));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: { code: "stale_profile_session" } });

  error = new LocalProfileRequestError(423, "profile_closing");
  response = proxy.proxy(request("/api/tasks"));
  assert.equal(response.status, 423);
  assert.deepEqual(await response.json(), { error: { code: "profile_closing" } });
});

test("proxy matcher excludes only the exact SSE endpoint", () => {
  const proxy = loadProxy(() => {});
  const matches = (pathname) => unstable_doesMiddlewareMatch({
    config: proxy.config,
    url: `http://localhost${pathname}`,
  });

  assert.equal(matches("/api/events"), false);
  assert.equal(matches("/api/events/"), false);
  assert.equal(matches("/api/events/child"), true);
  assert.equal(matches("/api/events-archive"), true);
  assert.equal(matches("/api/tasks"), true);
  assert.equal(matches("/api"), true);
  assert.equal(matches("/apis"), false);
});
