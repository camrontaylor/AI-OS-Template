# Context Farmer Job Example

This is an example only. It is not active in `cron/jobs/`.

To schedule a real source adapter:

1. Create the adapter under `context_farmers/adapters/<source>/`.
2. Confirm the permission scope and environment variable names.
3. Copy this file into `cron/jobs/`.
4. Replace the command with the adapter command.

```yaml
schedule: "0 8 * * 1-5"
timezone: "Australia/Melbourne"
```

Run the approved context farmer adapter and write results to
`context_farmers/inbox/`. Do not promote anything into canonical memory without
review.
