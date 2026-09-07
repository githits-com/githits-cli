---
"githits": none
"@githits/mcp": none
---

- **Release availability checks** - Both npm release pipelines wait for the exact
  package version to become public before downstream publication, and recover
  accepted uploads still undergoing npm scanning when a release job is rerun.
