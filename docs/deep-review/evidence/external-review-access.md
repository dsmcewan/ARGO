# External artifact retrieval retry

The supplied public page returned a generic artifact wrapper. Its document identifies frame `104e8895-b01a-4ce0-b077-3fd571fdd088` and prefetches its content through the `/api/frame/` bootstrap.

Following that actual bootstrap URL without authentication returned **HTTP 401 Unauthorized**. The public frame-shell JavaScript downloaded successfully (HTTP 200) and explicitly maps 401 to **“Sign in to view this page.”** The iframe content URL requires a version supplied by the denied bootstrap response, so no content URL was guessed and no sign-in boundary was bypassed.

No account endpoint, credentials, cookies, authorization tokens, login flow, or model provider was used. The shell and retrieval metadata are retained locally; the full review text was not obtained. Consequently the remaining fourteen findings cannot be summarized, ranked, or compared with the baseline on this evidence. The prior supplied findings 2–4 remain independently assessed in `triage/assessment.md`.

Relevant public-shell excerpt:

```js
),r){if(r.hidden=o,r.classList.remove("never-started"),r.textContent=e==="401"?"Sign in to view this page.":e===K_?"Artifacts aren\u2019t available for your organization.":e===
```
