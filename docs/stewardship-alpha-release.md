# Stewardship alpha compatibility

Engine `1.0.0-alpha.22` makes current-authority retry semantics available with exact dependency `@omniseed/omniform@1.0.0-alpha.7`. Historical authorization remains evidence of a past decision, but every retry revalidates the current stewardship control, approval, checks, and active lease. Paused, disabled, expired, or revoked authority and inactive or expired leases fail closed without double-charging the existing reservation.

The release preserves the public Engine API and its validation, independent-review, unchanged-head and successful-check gates. No autonomy authorization is granted by installing it.

Run `npm test` and `npm run test:consumer` before release. The consumer check installs a fresh packed Engine and registry OmniForm, checks the exact package pair and public policy exports, and verifies an approved exact-head proposal while rejecting missing review and changed-head approval. The Engine test suite additionally proves that retries revalidate current authority and do not consume the same reservation twice. After trusted publication, run `npm run test:consumer -- --published` to repeat against a fresh registry install of both packages. Record the merged source revision, publication run, registry integrity and consumer result on issue #56 before closing it.
