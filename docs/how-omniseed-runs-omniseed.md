# How OmniSeed runs OmniSeed

OmniSeed is the first dogfood company. Its YAML declaration requests four capabilities and selects providers by primitive family. The deployment sequence adopts the existing `omniseed-os` Vercel project, independently observes its production resource, and deploys Generation 1 as a non-production preview before any alias promotion.

```sh
omniseed bootstrap company.omniform.yaml --state .omniseed/state.json --out .omniseed/plan.json
omniseed approve company.omniform.yaml --state .omniseed/state.json --plan .omniseed/plan.json --actions all --out .omniseed/approval.json
omniseed apply company.omniform.yaml --state .omniseed/state.json --plan .omniseed/plan.json --approval .omniseed/approval.json
omniseed export-os company.omniform.yaml --state .omniseed/state.json --out ../omniseedos/runtime/company-runtime.json
omniseed redeploy company.omniform.yaml --state .omniseed/state.json --source ../omniseedos/.deployment
```

The plan contains only safe metadata. Vercel authentication remains in runtime CLI/environment configuration. Applying adoption does not recreate or modify the external project. Preview deployment does not move the production alias.
