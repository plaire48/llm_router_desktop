# Optional screen knowledge dependencies

The base module has no mandatory runtime dependency. The optional Stagehand entry point imports host-installed Stagehand 3.7.3 and Zod 4.4.3. Their distributed packages retain their own licenses. No upstream SDK implementation, prompts or assets have been copied into this module.

- Stagehand: Browserbase Inc., MIT. https://github.com/browserbase/stagehand
- Zod: Colin McDonnell and contributors, MIT. https://github.com/colinhacks/zod
- Playwright: Microsoft Corporation, Apache-2.0; existing optional host peer. https://github.com/microsoft/playwright

The development dependency graph pins the Stagehand provider-utils dependency on Undici 6.28.1 for security fixes. Undici is MIT licensed and retains its own package notices. https://github.com/nodejs/undici

The host is responsible for notices of dependencies it distributes, including transitive dependencies. These references do not grant rights to copy unrelated product code or imply that the referenced packages are bundled in the base addon.
