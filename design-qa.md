# CyberCode VitePress Home Design QA

- Source visual truth: `/Users/wang/.codex/generated_images/019f234c-5a9f-7d03-8b93-c7f51cb8752b/exec-d5a9d04d-12c9-40a0-b6bf-312983d6144d.png`
- Implementation screenshot: `/tmp/cybercode-hero-v2-light-desktop.png`
- Viewport: 1440 x 1024 desktop; 390 x 844 mobile
- State: Chinese home in light and dark themes; macOS/Linux installer selected
- Full-view comparison: `/tmp/cybercode-design-comparison-hero-v2.png`
- Focused hero comparison: `/tmp/cybercode-design-comparison-hero-v2-focused.png`
- Dark-theme before/after: `/tmp/cybercode-audit-before-after-dark.png`
- Mobile before/after: `/tmp/cybercode-audit-before-after-mobile.png`
- Focused terminal comparison: not recaptured because this pass did not change the terminal component or its boundary

## Findings

No actionable P0, P1, or P2 differences remain.

- Typography: The implemented product name, companion-focused heading, Hermes promise, provider line, and button hierarchy closely match the selected visual. Text uses the existing VitePress font stack for multilingual reliability; wrapping remains stable in Chinese, English, Japanese, and Korean.
- Spacing and layout: Hero alignment, content width, portrait scale, terminal boundary, and next-section reveal match the selected composition. The mobile character now ends 43px above the product name instead of overflowing into it. Desktop and mobile have no horizontal overflow.
- Colors and tokens: The previous orange theme is replaced by cobalt, cyan, magenta, yellow, near-black, and white sampled from the supplied character art. Light and dark themes retain readable contrast.
- Image quality: Navigation uses the supplied CyberCode wordmark. The hero now uses a 1254 x 1254 ImageGen-restored RGBA character asset instead of the previous 512 x 512 white-backed crop. It renders at no more than 780px wide, remains sharp, and has no visible white box or chroma fringe in light or dark mode.
- Copy: The primary promise explicitly describes Hermes-style self-evolution and its persistent memory, skill, and reusable-workflow outcomes. Provider support remains a separate secondary line.
- Icons and controls: The copy control uses VitePress's native clipboard icon token. Platform tabs, command copying, theme switching, navigation links, and locale routes are functional.
- Accessibility and responsiveness: Focus styles remain visible, the installer exposes tab and tabpanel semantics, imagery has localized alt text, and the 390 x 844 layout separates the portrait from the heading while preserving a visible terminal entry point.

## Comparison History

1. Initial implementation
   - P2: The mobile portrait visually overlapped the `CyberCode` heading.
   - P2: Desktop title, portrait, and content margins were underscaled relative to the selected visual.
   - Fixes: Added positive mobile image-to-title spacing; increased desktop horizontal inset, hero top rhythm, title scale, portrait scale, and terminal alignment.

2. Desktop refinement
   - P2: The portrait and core promise remained slightly less prominent than the selected visual.
   - Fixes: Increased final title, subtitle, promise, action spacing, and portrait scale while preserving the fixed hero-to-terminal boundary.
   - Post-fix evidence: `/tmp/cybercode-design-comparison-final.png`, `/tmp/cybercode-design-comparison-hero.png`, and `/tmp/cybercode-design-comparison-terminal.png`.

3. Public deployment validation
   - P1: A browser that had visited the pre-deployment URL retained the earlier cached 404 for the hero image, although the deployed file and checksum were correct.
   - Fix: Published the supplied character asset under the versioned path `cybercode-hero-character-v1.png` and updated every locale to use it, bypassing stale negative caches.
   - Post-fix evidence: public browser validation at `https://wk42worldworld.github.io/cybercode/` with the versioned image loaded and no broken images.

4. Companion positioning copy
   - Revision: Replaced the functional local-client heading with the more personal "AI coding partner fighting by your side" positioning across Chinese, English, Japanese, and Korean.
   - Validation: Rechecked desktop and mobile wrapping for every locale with no clipping or horizontal overflow.

5. Desktop download routing
   - Revision: Routed the desktop CTA directly to the latest GitHub Release and replaced the redundant hero GitHub link with a localized mainland China mirror CTA using `ghfast.top`.
   - Validation: Confirmed both routes resolve to the current release page, and rechecked all four locales at desktop and mobile widths with no clipped actions or horizontal overflow.

6. High-resolution transparent hero asset
   - P1: The previous image contained a large white backing area that became a dominant rectangle in dark mode.
   - P2: The 512 x 512 raster was enlarged to roughly 820px, softening character details and drifting from the selected mock.
   - P2: At 390px wide, the 350px image exceeded its 274px container and visually overlapped the `CyberCode` product name.
   - Fixes: Generated a higher-resolution character restoration with ImageGen, removed its flat chroma background into alpha, capped desktop display at 780px, and resized/re-spaced tablet and mobile layouts.
   - Post-fix evidence: `/tmp/cybercode-design-comparison-hero-v2-focused.png`, `/tmp/cybercode-audit-before-after-dark.png`, and `/tmp/cybercode-audit-before-after-mobile.png`.

## Primary Interactions Tested

- macOS/Linux and Windows installer tabs switch commands correctly.
- Copy action writes the selected command and exposes the localized copied state.
- Desktop download opens the latest GitHub Release; the mainland China mirror opens the same release through `ghfast.top`.
- Light and dark theme switching works with no broken imagery or background rectangle.
- Chinese, English, Japanese, and Korean home routes render localized Hermes copy without overflow.
- Browser console errors and warnings checked: none.

## Follow-up Polish

- P3: The mock's decorative multicolor calibration rule is intentionally omitted; the real character art already supplies the brand spectrum without adding CSS decoration.
- P3: The real CLI command remains on one line at wide desktop widths instead of reproducing the mock's artificial wrap, improving copy scanning.

## Implementation Checklist

- [x] Use real CyberCode wordmark and female character assets.
- [x] Replace orange tokens with the character-derived palette.
- [x] Add localized Hermes self-evolution copy.
- [x] Match the selected hero and terminal composition.
- [x] Replace the 512px white-backed portrait with a higher-resolution transparent character asset.
- [x] Keep a visible mobile gap between the portrait and product name.
- [x] Verify desktop, mobile, dark theme, locales, and copy interaction.

final result: passed
