#!/usr/bin/env node
"use strict";

// notify-push.js
//
// Sends a phone push for AI-OS cron events via ntfy (https://ntfy.sh), so a
// failed scheduled job is LOUD instead of a macOS banner nobody sees when the
// laptop is closed or away from the desk. No account and no secret token are
// required: you pick an unguessable topic, subscribe to it in the ntfy phone
// app, and the daemon POSTs to it.
//
// Config resolution (first match wins):
//   1. env  AIOS_NTFY_TOPIC   (+ optional AIOS_NTFY_SERVER, default https://ntfy.sh)
//   2. file <workspace>/.command-centre/notify-config.json
//        { "ntfy": { "server": "https://ntfy.sh", "topic": "aios-xxxx" } }
// No config -> no-op (returns {sent:false, reason:"not-configured"}). Safe by default.
//
// Never throws: every failure path resolves to {sent:false, ...} so a push
// problem can never break a notification, a job, or the daemon.
//
// CLI (for testing and the dead-man's-switch watchdog):
//   node notify-push.js "Title" "Message body" [priority]
//   AIOS_WORKSPACE_DIR=/path/to/AI-OS node notify-push.js "Title" "Body" urgent

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

function asciiHeader(value) {
  // ntfy header values (Title/Tags) must be latin-1 safe and single-line.
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 250);
}

function resolveConfig(agenticOsDir) {
  const envTopic = process.env.AIOS_NTFY_TOPIC;
  if (envTopic && String(envTopic).trim()) {
    return {
      server: process.env.AIOS_NTFY_SERVER || "https://ntfy.sh",
      topic: String(envTopic).trim(),
    };
  }
  if (!agenticOsDir) return null;
  try {
    const cfgPath = path.join(agenticOsDir, ".command-centre", "notify-config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (cfg && cfg.ntfy && cfg.ntfy.topic && String(cfg.ntfy.topic).trim()) {
      return {
        server: cfg.ntfy.server || "https://ntfy.sh",
        topic: String(cfg.ntfy.topic).trim(),
      };
    }
  } catch (_) {
    // missing or malformed config -> not configured
  }
  return null;
}

function sendPush(agenticOsDir, opts = {}) {
  return new Promise((resolve) => {
    let cfg = null;
    try {
      cfg = resolveConfig(agenticOsDir);
    } catch (_) {
      cfg = null;
    }
    if (!cfg) {
      resolve({ sent: false, reason: "not-configured" });
      return;
    }

    let base;
    try {
      base = new URL(cfg.server);
    } catch (_) {
      resolve({ sent: false, reason: "bad-server" });
      return;
    }

    const lib = base.protocol === "http:" ? http : https;
    const body = Buffer.from(
      String(opts.message || opts.title || "AI-OS cron event"),
      "utf8"
    );
    const headers = {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": body.length,
    };
    if (opts.title) headers["Title"] = asciiHeader(opts.title);
    if (opts.priority) headers["Priority"] = String(opts.priority);
    if (opts.tags) {
      headers["Tags"] = asciiHeader(
        Array.isArray(opts.tags) ? opts.tags.join(",") : opts.tags
      );
    }

    const req = lib.request(
      {
        method: "POST",
        hostname: base.hostname,
        port: base.port || (base.protocol === "http:" ? 80 : 443),
        path: "/" + encodeURIComponent(cfg.topic),
        headers,
        timeout: 5000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          resolve({
            sent: ok,
            statusCode: res.statusCode,
            reason: ok ? undefined : "http-" + res.statusCode,
            body: data.slice(0, 200),
          });
        });
      }
    );
    req.on("error", (err) =>
      resolve({ sent: false, reason: "error", error: String((err && err.message) || err) })
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ sent: false, reason: "timeout" });
    });
    req.write(body);
    req.end();
  });
}

module.exports = { sendPush, resolveConfig };

if (require.main === module) {
  const title = process.argv[2] || "AI-OS test";
  const message = process.argv[3] || "notify-push test";
  const priority = process.argv[4] || "default";
  const dir = process.env.AIOS_WORKSPACE_DIR || path.resolve(__dirname, "..", "..");
  sendPush(dir, { title, message, priority, tags: "test_tube" }).then((r) => {
    console.log(JSON.stringify(r));
    process.exit(r.sent ? 0 : 1);
  });
}
