# Deploy Baselines

## 2026-03-21 Production Baseline

- Environment: Cloudflare Pages (production)
- Base URL: https://d19f6ccc.ceoflow.pages.dev
- Captured at (UTC): 2026-03-21T09:20:52Z

### Response Time (ms)

| Endpoint | Method | Runs | Status | Avg | Run 1 | Run 2 | Run 3 |
|---|---|---:|---|---:|---:|---:|---:|
| / | GET | 3 | 200 | 184.20 | 296.43 | 126.47 | 129.69 |
| /api/list-groups | GET | 3 | 200 | 842.50 | 1291.60 | 596.97 | 638.93 |
| /api/sync-all-groups | POST | 1 | 200 | 10685.13 | 10685.13 | - | - |

### Sync Counters

- listGroupsCount: 1
- syncAllSynced: 1
- syncAllSuccess: true
- syncAllSource: kv
- teamSynced: 3
- teamAttempted: 3

### Notes

- Baseline includes one full `sync-all` execution (writes are expected as part of sync path).
- `sync-all` response contained warnings related to unavailable/permission-limited LINE/Firestore member listing in fallback paths, while overall sync still succeeded.

### Compare Next Deploy

Use the same endpoints and compare:

- rootAvgMs
- listGroupsAvgMs
- syncAllMs
- listGroupsCount
- syncAllSynced
- teamSynced / teamAttempted

Machine-readable snapshot for this baseline:

- docs/baselines/2026-03-21-ceoflow-pages-prod.json
