# License review: `unofficial-api-for-xhamster` (AGPL-3.0-only)

This review covers how the analyzed Python project
(`api/unofficial-api-for-xhamster-main/`, licensed **AGPL-3.0-only**) relates to
this Vega provider repository. It is a technical assessment, not legal advice.
Consult a qualified lawyer before any commercial deployment.

## 1. What the license requires (relevant highlights)

- **Conveying source (AGPL §4–5, §13).** Anyone who conveys a covered work must
  provide the Corresponding Source and keep copyright/license notices intact.
- **Network clause (AGPL §13).** If you *modify* the Program and let users
  interact with your modified version remotely over a computer network, you must
  offer those users the Corresponding Source at no charge via a network server.
- **Automatic downstream licensing (AGPL §10).** Every recipient is licensed
  automatically; you may not add further restrictions.
- **License notice in README (author's caution).** The project README warns that
  using it in a proprietary application — including hosting it over a network —
  requires open-sourcing the entire application under AGPL, or purchasing a
  commercial license from the author (contact `EchterAlsFakeBS@proton.me`).

## 2. Does this repository create a derivative work of the Python project?

**No Python code is copied, adapted, linked, or bundled** into this repository.
This repo contains:

- TypeScript Vega provider modules (written against the Vega framework types),
- documentation,
- the Vega template's own tooling and example provider.

The provider communicates with any future backend **only over HTTP**. It never
includes, embeds, or statically/dynamically links the Python library. Under the
AGPL's own terminology this is an independent work (an "aggregate" per §5 is not
even reached, since the programs are not combined on the same medium into a
larger program). The Vega provider repo itself therefore does **not** become a
covered work, and this repository stays under the Vega template's ISC license.

## 3. Source-distribution obligations

They apply **to the Python project itself**, not to this repo:

- If the Python project (or a modified version of it) is ever deployed as a
  network service, **that service** must make its Corresponding Source available
  to its users at no charge (AGPL §13) and must keep the AGPL license text and
  copyright notice intact.
- Attribution is preserved here: `docs/xhamster-api-analysis.md` names the
  author and project, and this review links the license. No attribution or
  license information was removed.

## 4. Hosting / distribution-model compatibility

The intended model is:

```
Vega App ──HTTP──▶ Vega provider (TS, ISC) ──HTTP──▶ separate Python service (AGPL)
                                                          │
                                                          ▼
                                               authorized backend / official API
```

- The **provider** (published in this public repo) is a separate, independently
  licensed program. AGPL does not "infect" it because it does not incorporate
  AGPL code.
- A **deployed Python service** that uses the library (or a modified fork) is a
  covered work. It must be AGPL-3.0 licensed and ship source; it cannot be
  wrapped in closed-source infrastructure while remaining compliant.
- Running the **unmodified** library for personal use does not trigger the
  network-source obligation; hosting a *modified* version for network users
  does.

## 5. Open questions / uncertainty

- Whether a particular deployment is "modification" vs. "mere aggregation" can
  be fact-specific. The safest posture for any public service is to treat it as
  a covered work: ship the full service source under AGPL.
- This analysis assumes the xHamster provider integration is **authorized** by
  xHamster. The AGPL analysis is independent of that authorization, but both are
  prerequisites before any real backend is deployed.
- If this provider were ever bundled into a larger proprietary application in a
  way the courts treat as a combined work with the AGPL service, the AGPL could
  reach further. Mitigate by keeping the service strictly separate (own process,
  own repository, own deployment).

## 6. Conclusion and actions taken

- **No derivative work** is created by this repository; no AGPL code is copied
  in. The repo remains under the template's ISC license.
- Attribution and license notices for the analyzed project are preserved in this
  documentation.
- **No Python service is deployed and playback remains disabled.** The provider
  will not be wired to the unofficial scraper, because doing so would violate
  both the "authorized streaming only" mission and the license/anti-bot
  constraints. The service design in `docs/python-integration.md` is a blueprint
  only, to be built and deployed **only after** official xHamster authorization
  and legal review.
