# Stewardship alpha compatibility

Engine `1.0.0-alpha.21` makes the already-merged bounded stewardship runtime available with exact dependency `@omniseed/omniform@1.0.0-alpha.7`. The previous Engine alpha used OmniForm alpha.6 and did not distribute the new declaration contract as a matched package pair.

The release preserves the public Engine API and its validation, independent-review, unchanged-head and successful-check gates. No autonomy authorization is granted by installing it.

Run `npm test` and `npm run test:consumer` before release. The consumer check installs a fresh packed Engine and registry OmniForm, checks the exact package pair and public policy exports, and verifies an approved exact-head proposal while rejecting missing review and changed-head approval. After trusted publication, run `npm run test:consumer -- --published` to repeat against a fresh registry install of both packages. Record the merged source revision, publication run, registry integrity and consumer result on issue #53 before closing it.
