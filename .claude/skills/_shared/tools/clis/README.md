# AI-OS Shared CLIs

Standalone Node.js tools supporting the installed skills. No package installation is required.
Use Node.js 22 or newer so credentials can be loaded from AI-OS's ignored `.env` files.

## Run in the active workspace

From the AI-OS root, preview a read request:

```bash
node --env-file-if-exists=.env .claude/skills/_shared/tools/clis/ahrefs.js backlinks list --target example.com --dry-run
```

For a client session, resolve the AI-OS root and the active client from the session's workspace,
use the shared CLI's absolute path, and pass `--env-file-if-exists` for the root `.env`, then
the active client's `.env`. Client values take precedence. Never load another client's secrets.
Use only the injected session scope when connected to Team OS; use an authorized tool connector
instead of direct local credential loading in that mode.

## Authentication

| CLI | Environment variables |
|-----|-----------------------|
| `activecampaign` | `ACTIVECAMPAIGN_API_KEY`, `ACTIVECAMPAIGN_API_URL` |
| `adobe-analytics` | `ADOBE_ACCESS_TOKEN`, `ADOBE_CLIENT_ID`, `ADOBE_COMPANY_ID` |
| `ahrefs` | `AHREFS_API_KEY` |
| `airops` | `AIROPS_API_KEY`, `AIROPS_WORKSPACE_ID` |
| `amplitude` | `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY` |
| `apollo` | `APOLLO_API_KEY` |
| `beehiiv` | `BEEHIIV_API_KEY` |
| `brevo` | `BREVO_API_KEY` |
| `buffer` | `BUFFER_API_KEY` |
| `calendly` | `CALENDLY_API_KEY` |
| `clay` | `CLAY_API_KEY` |
| `clearbit` | `CLEARBIT_API_KEY` |
| `close` | `CLOSE_API_KEY` |
| `coupler` | `COUPLER_API_KEY` |
| `crossbeam` | `CROSSBEAM_API_KEY` |
| `customer-io` | `CUSTOMERIO_API_KEY`, `CUSTOMERIO_APP_KEY`, `CUSTOMERIO_SITE_ID` |
| `dataforseo` | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| `demio` | `DEMIO_API_KEY`, `DEMIO_API_SECRET` |
| `dub` | `DUB_API_KEY` |
| `exa` | `EXA_API_KEY` |
| `g2` | `G2_API_TOKEN` |
| `ga4` | `GA4_ACCESS_TOKEN` |
| `github-prospects` | `GITHUB_TOKEN` |
| `google-ads` | `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_TOKEN` |
| `google-search-console` | `GSC_ACCESS_TOKEN` |
| `hotjar` | `HOTJAR_CLIENT_ID`, `HOTJAR_CLIENT_SECRET` |
| `hunter` | `HUNTER_API_KEY` |
| `instantly` | `INSTANTLY_API_KEY` |
| `intercom` | `INTERCOM_API_KEY` |
| `keywords-everywhere` | `KEYWORDS_EVERYWHERE_API_KEY` |
| `kit` | `KIT_API_KEY`, `KIT_API_SECRET` |
| `klaviyo` | `KLAVIYO_API_KEY` |
| `lemlist` | `LEMLIST_API_KEY` |
| `linkedin-ads` | `LINKEDIN_ACCESS_TOKEN` |
| `livestorm` | `LIVESTORM_API_TOKEN` |
| `mailchimp` | `MAILCHIMP_API_KEY` |
| `mention-me` | `MENTIONME_API_KEY` |
| `meta-ads` | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` |
| `mixpanel` | `MIXPANEL_API_KEY`, `MIXPANEL_SECRET`, `MIXPANEL_TOKEN` |
| `onesignal` | `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY` |
| `optimizely` | `OPTIMIZELY_API_KEY` |
| `outreach` | `OUTREACH_ACCESS_TOKEN` |
| `paddle` | `PADDLE_API_KEY`, `PADDLE_SANDBOX` |
| `partnerstack` | `PARTNERSTACK_PUBLIC_KEY`, `PARTNERSTACK_SECRET_KEY` |
| `pendo` | `PENDO_INTEGRATION_KEY` |
| `plausible` | `PLAUSIBLE_API_KEY`, `PLAUSIBLE_BASE_URL` |
| `postmark` | `POSTMARK_API_KEY` |
| `rankparse` | `RANKPARSE_API_KEY` |
| `resend` | `RESEND_API_KEY` |
| `rewardful` | `REWARDFUL_API_KEY` |
| `savvycal` | `SAVVYCAL_API_KEY` |
| `segment` | `SEGMENT_ACCESS_TOKEN`, `SEGMENT_WRITE_KEY` |
| `semrush` | `SEMRUSH_API_KEY` |
| `sendgrid` | `SENDGRID_API_KEY` |
| `similarweb` | `SIMILARWEB_API_KEY` |
| `snov` | `SNOV_CLIENT_ID`, `SNOV_CLIENT_SECRET` |
| `supermetrics` | `SUPERMETRICS_API_KEY` |
| `tiktok-ads` | `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID` |
| `tolt` | `TOLT_API_KEY` |
| `trustpilot` | `TRUSTPILOT_API_KEY`, `TRUSTPILOT_API_SECRET`, `TRUSTPILOT_BUSINESS_UNIT_ID` |
| `typeform` | `TYPEFORM_API_KEY` |
| `wistia` | `WISTIA_API_KEY` |
| `zapier` | `ZAPIER_API_KEY` |
| `zoominfo` | `ZOOMINFO_ACCESS_TOKEN`, `ZOOMINFO_PRIVATE_KEY`, `ZOOMINFO_USERNAME` |

## Credentials and execution

Credentials belong in the active workspace's gitignored `.env`; `.env.example` documents optional names.
Never print credential values or put them in a command argument, saved artifact, or source file.
`--dry-run` previews supported requests with masked credentials and sends no API request.
It still requires the environment variables that the selected CLI checks at startup.
Use only dummy values when validating dry runs; do not read real credentials for validation.
Some vendor operations incur charges. Verify current vendor documentation, availability and pricing
before executing a paid operation. A missing key falls back to user-provided exports or manual setup.

Publishing, sending messages, changing budgets, deleting records and other external writes require
the user's instruction for that action. Prepare a reviewable artifact first when authorization
does not cover the final action. Loading a skill alone does not authorize these operations.

Commands print JSON to stdout. Save exports and reports under the calling skill's
`projects/{skill-name}/{YYYY-MM-DD}_{project}/` folder.

## Installed CLIs

`activecampaign.js`, `adobe-analytics.js`, `ahrefs.js`, `airops.js`, `amplitude.js`, `apollo.js`, `beehiiv.js`, `brevo.js`, `buffer.js`, `calendly.js`, `clay.js`, `clearbit.js`, `close.js`, `coupler.js`, `crossbeam.js`, `customer-io.js`, `dataforseo.js`, `demio.js`, `dub.js`, `exa.js`, `g2.js`, `ga4.js`, `github-prospects.js`, `google-ads.js`, `google-search-console.js`, `hotjar.js`, `hunter.js`, `instantly.js`, `intercom.js`, `keywords-everywhere.js`, `kit.js`, `klaviyo.js`, `lemlist.js`, `linkedin-ads.js`, `livestorm.js`, `mailchimp.js`, `mention-me.js`, `meta-ads.js`, `mixpanel.js`, `onesignal.js`, `optimizely.js`, `outreach.js`, `paddle.js`, `partnerstack.js`, `pendo.js`, `plausible.js`, `postmark.js`, `rankparse.js`, `resend.js`, `rewardful.js`, `savvycal.js`, `segment.js`, `semrush.js`, `sendgrid.js`, `similarweb.js`, `snov.js`, `supermetrics.js`, `tiktok-ads.js`, `tolt.js`, `trustpilot.js`, `typeform.js`, `wistia.js`, `zapier.js`, `zoominfo.js`.

Platform capabilities and setup are indexed in [the registry](../REGISTRY.md).
