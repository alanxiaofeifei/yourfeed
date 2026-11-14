# ADR 0001 — Lightweight onboarding popover

- Status: accepted locally, Phase A / Issue #11 / [PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8); no release approval.
- Research snapshot: 2026-11-14 UTC. Repository [LICENSE](../../LICENSE): MIT.
- Decision: independently implement a minimal **driver.js-like** React popover, one decorative spotlight and CSS arrow. No library code copied, no dependencies added; application code remains MIT.

## Options and size evidence

| Option (pinned research version) | License | npm archive / unpacked bytes | Assessment |
| --- | --- | ---: | --- |
| [driver.js 1.14.0](https://registry.npmjs.org/driver.js/1.14.0) | [MIT](https://cdn.jsdelivr.net/npm/driver.js@1.14.0/license) | 87,771 / 355,805 | Best external fallback: dependency-free highlight/popover/navigation, but another imperative lifecycle. |
| [Shepherd 16.0.0](https://registry.npmjs.org/shepherd.js/16.0.0) | [AGPL-3.0 / commercial](https://cdn.jsdelivr.net/npm/shepherd.js@16.0.0/LICENSE.md) | 119,326 / 367,933 | Adds licensing review and positioning lifecycle. |
| [Intro.js 8.6.0](https://registry.npmjs.org/intro.js/8.6.0) | [AGPL-3.0 / commercial](https://cdn.jsdelivr.net/npm/intro.js@8.6.0/license.md) | 270,461 / 1,005,410 | Avoid new copyleft/commercial licensing obligations. |
| [Reactour 3.8.0](https://registry.npmjs.org/%40reactour%2Ftour/3.8.0) | [MIT](https://cdn.jsdelivr.net/npm/@reactour/tour@3.8.0/LICENSE) | 22,325 / 98,464 | React-native; additional mask/popover/utils packages. |
| [Onborda 1.2.5](https://cdn.jsdelivr.net/npm/onborda@1.2.5/package.json) | MIT declared in manifest; full grant not independently located | 135,413 / 479,181 | Requires Framer Motion and Radix portal peers absent from this app. |
| [React Joyride 3.2.0](https://cdn.jsdelivr.net/npm/react-joyride@3.2.0/package.json) | [MIT](https://cdn.jsdelivr.net/npm/react-joyride@3.2.0/LICENSE) | 169,496 / 720,031 | React 19 supported; capable but adds Floating UI/focus subsystem. |

Sizes were measured from pinned registry tarballs and `dist.unpackedSize`, Node 24.22.1. They are **package distribution sizes, NOT delivered JS, gzip bundle comparisons or dependency-inclusive sizes**. No apples-to-apples library bundling experiment was run; zero new dependencies does not mean zero application bytes. Reproduce with registry version JSON, download `dist.tarball`, count its bytes, and read `dist.unpackedSize`.

MIT options fit the repository's downstream distribution model when notices are preserved. AGPL is not inherently incompatible with MIT code nor does it prohibit commercial use, but can impose different obligations on the combined work; no such licensing decision is needed here.

## Product-pattern review

This is a brief public-document review, not a logged-in audit of proprietary implementations:

- [Notion teammate onboarding](https://www.notion.com/help/guides/first-steps-introduce-notion-teammate): a lasting help entry, learning real tasks, deeper resources outside the immediate prompt.
- [Linear Start Guide](https://linear.app/docs/start-guide.md): optional, task-oriented introduction and separate deeper guides/demo resources. No claim about its private tour DOM or performance.
- [Chromium user education](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/user_education/getting-started.md) and [help-bubble requirements](https://chromium.googlesource.com/chromium/src/+/HEAD/components/user_education/custom-help-bubbles.md): stable anchors, visible dismiss, Escape equivalence, deliberate focus/accessibility.

## Implementation and trade-offs

React owns translated content, position and a serialized optimistic persistence queue. Each click updates only the child controller immediately; background CAS writes retain **every** viewed/skipped action, rebase server evidence, and roll back dependent actions on failure. Conflicts reread authoritative state rather than replay over another tab's dismissal. The API, eligibility cutoff, evidence and two source entries do not change.

A viewport-clamped desktop popover flips around the target; narrow viewports use a compact opposite-side sheet. The portal stays **inside the active source dialog's focus scope**, even though the panel is visually fixed. The spotlight is decorative/pointer-transparent and shares the active dialog backdrop's stacking scope (otherwise body), so its dim cannot paint above the tour controls. Observed geometry is rAF-coalesced, outside React state; no polling or positioning package. Original guidance and evidence remain behind translated details. Site editorial tokens and CSS motion are reused; reduced motion removes animated movement. Standard Tab, arrows, Esc, live progress and focus restoration remain application-owned.

We consequently own collision handling, visualViewport/scroll/resize, focus and accessibility regressions. Custom code is not automatically faster, smaller or more accessible; production-build browser measurements and tests are required. Real screen readers, mobile keyboards and 200% zoom remain manual release checks. Revisit driver.js first if general-purpose placement or route complexity exceeds this narrow scope.
