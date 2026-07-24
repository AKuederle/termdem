# Backwards-compatibility policy

- Backwards compatibility is not guaranteed; small public-interface breaks are allowed when accompanied by a clear migration guide.
- Internal refactors may make hard cuts, but every in-repository consumer must be updated in the same change.
- Larger public-interface breaks require explicit user approval; all accepted breaking changes must be prominently documented for downstream consumers.
