# Balance execution evidence

No training or held-out outcome study has run at this checkpoint. The preregistered500-per-partition design remains unchanged.

The ten-seed timing pilot ran against assembled commit `d156819b3e988467148a615aaa0d528e1acae949` using the real pure reducer. It completed210 combat trials and80 resource trials, replaying every trial, in6385.032605ms. The report deliberately contains no endpoint rates or selection recommendation. Linear extrapolation suggests about5.3 minutes per500-seed partition on this environment, but sustained runtime may differ. This estimate is not a reason to change sample counts based on outcomes.

- [Pilot intent](pilot-d156819.json.started.json): `f8f892a43716ee578d0da6bdc33ddaca73d09c02efd12f9f72ecb8942e0c34c7`.
- [Pilot report](pilot-d156819.json): `fbdf013a35eb3d70847ffa7a145b240b267e34b2f1dcbd520716e2c9197916aa`.
- [Native CLI completion](pilot-d156819.log).
- [Initial sandbox preflight failure](pilot-sandbox-preflight.log): Node could not spawn read-only Git (`EPERM`). This happened during source collection, before any intent file or trial. The native invocation was authorized and completed.

The pilot predates the subsequent reporting-only change that includes imported SYSTEMS schemas and dependency lock/manifests in the source fingerprint. Its narrower source fingerprint is retained exactly as produced; the forthcoming training and heldout reports must use the expanded fingerprint. Pilot seeds are a separate domain and do not enter either outcome partition. No study seed was substituted or outcome used to change a policy.

Combined validation before the pilot passed25 focused tests, including7 balance tests, and strict TypeScript checking. Those are coordinator logs (`/tmp/argo-rp-assembled-focused.log`, `/tmp/argo-rp-combined-types.log`), not claims that this isolated lane checkout contains the core/dependencies. No production storage, Board state, remote refs or model services were written by these experiments.
