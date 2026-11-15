# Evidence retention

All paths in manifest.json are repository-relative artifacts with SHA-256 identities. Human logs retain original environment paths as provenance; they are not dependencies. Use the checkout-root arguments shown in the parent README for portable probes. The original triage/probes.mjs and resolve.mjs are historical; triage/probes-portable.mjs replaces their environment-specific paths for reruns.

External artifact wrapper/JavaScript bodies were inspected locally but are not redistributed; external-review-access.json records their hashes and the content bootstrap 401. Intermediate reviews are pinned to e5a6c55 and 97dc6c0; only review-final-9564af2.md is the final implementation verdict. Complete application acceptance is recorded separately under full-gate/.
