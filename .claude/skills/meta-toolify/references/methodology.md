# Integration method

## Categories and interview

Payments require signed webhooks and event idempotency. Auth requires session/redirect and refresh handling.
Email needs sender identity and unsubscribe behavior. CMS/data needs migrations and client lifecycle.
AI services need supported models, streaming choices, budget, and rate limits. Storage needs scoped signed URLs.
Analytics needs intentional script/event placement. MCP integrations need actual server configuration and permissions.
For any category establish project path, real stack, auth type, SDK, environments, webhook needs, limits,
client location, data sensitivity, and a precise read-only success check.

## Official implementation

Read current official quickstart and SDK docs. Prefer a maintained official SDK; raw requests are appropriate
when an SDK adds no value. Record version/source date. Reuse a recipe only if its file actually exists.
Do not infer a connected MCP, documentation plugin, or previously authenticated account from an example.

## Scaffolding patterns

For Next.js, conventional locations are src/lib/{service}.ts, optional
src/app/api/webhooks/{service}/route.ts and an explicit non-destructive usage example.
For Rails, conventional locations are config/initializers/{service}.rb, app/services/{service}_client.rb,
optional webhook controller, and a merged route. Other stacks follow existing project conventions.
For MCP, merge an actual server entry without replacing unrelated configuration; secret references stay secret.
Keep business logic separate from integration plumbing.

## Auth and secrets

Use exact documented auth headers. Verify signed webhooks with the vendor algorithm and raw body requirements.
Scope OAuth grants and token refresh. Signed URLs expire. Only intentionally public values belong in client bundles.
Tracked env examples contain placeholders; real credentials live in the workspace's secret environment.
Never print secrets or pass them through shell arguments. Node tools use a supported Node 22 runtime and
--env-file-if-exists for root and active-client .env files, with the client file last.

## Native registration and verification

Document root services in AGENTS.md, .env.example and README.md; client-only services remain in the client.
Run a read-only authenticated smoke test, inspect failures, and report verified results versus manual prerequisites.
Save the reusable recipe in `context/config/meta-toolify/recipes/` and the report in the dated project directory.
