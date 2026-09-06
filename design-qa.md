# basdraw design QA

## Source truth and evidence

- User reference: `/var/folders/b_/t3m1lbpx5d5dzqv6pkfkhhn00000gn/T/codex-clipboard-58e70a98-5f01-40cc-bd2c-56648cb223e3.png`
- Official tldraw sidebar asset: `https://github.com/tldraw/tldraw/blob/main/apps/dotcom/client/public/tldraw_sidebar_logo.svg`
- Official tldraw renderer: `https://github.com/tldraw/tldraw/blob/main/apps/dotcom/client/src/tla/components/TlaLogo/TlaLogo.tsx`
- Corrected light implementation: `/Users/benhansen/Projects/bas-whiteboard/design-qa-light-refined.jpg`
- Corrected dark implementation: `/Users/benhansen/Projects/bas-whiteboard/design-qa-dark-refined.jpg`
- Corrected focused header: `/Users/benhansen/Projects/bas-whiteboard/design-qa-light-header-refined.jpg`
- Browser: Codex in-app Browser
- CSS viewport and implementation pixels: 1280 x 720 at 1x density
- Reference pixels: 160 x 64
- Focused implementation pixels: 210 x 64 at 1x density
- State: disconnected station form, empty canvas, tldraw Light and Dark themes

## Research result

The current tldraw sidebar logo is not text rendered in `tldraw_draw`. It is a 70 x 19 SVG mask whose icon and six wordmark letters are custom vector outlines. The production component applies the full mask at exactly 70 x 19 and colors it with the active tldraw text token. A local comparison against rounded-heavy typefaces showed SF Pro Rounded Heavy as the closest available text construction for the new letters in `basdraw`; Shantell Sans (`tldraw_draw`) was visibly incorrect.

At the 2x scale shown in the supplied reference, the official geometry resolves to an approximately 34.3 x 36.2 tile, 7.9 px gap, and 24.6 px-tall wordmark. That direct-size implementation was still too heavy and large in the basdraw sidebar. The final user-directed refinement uses a 30 x 32 tile at x 14/y 10, a 7 px gap, and a lighter 21.12 px-tall wordmark beginning at x 51/y 15.44. The tagline remains outside the logo row so it does not disturb the alignment.

## Findings and comparison history

### Iteration 1: blocked

- [P1] Wrong wordmark construction
  - Evidence: the implementation used the sketchy `tldraw_draw` face while the reference uses smooth, heavy custom vector lettering.
  - Fix: replaced it with a rounded-heavy stack led by `ui-rounded` and SF Pro Rounded Heavy.
- [P1] Incorrect logo-row proportions
  - Evidence: the earlier wordmark was too small and sat at the top of the tile because the tagline shared its flex column.
  - Fix: separated the logo row from the tagline and matched the official tile, gap, wordmark height, and x/y placement.

### Iteration 2: blocked after review

- [P2] Lockup still too heavy and large
  - Evidence: the user found the 28 px, weight 900 wordmark and 34 x 36 tile too visually dominant in the sidebar.
  - Fix: reduced the wordmark to 24 px and weight 800, tightened the tile to 30 x 32, reduced the gap to 7 px, and shortened the tagline.

### Iteration 3: passed

- Fonts and typography: rounded-heavy construction still follows the official letterform direction at the lighter user-selected 24 px size, 800 weight, 21.12 px rendered height, and less aggressive tracking.
- Spacing and rhythm: the whole lockup is reduced without changing its internal relationship; the tagline begins directly under the wordmark at x 51.
- Colors and tokens: light wordmark is `rgb(28, 28, 28)`; the flat tile is `rgb(29, 29, 29)` with a white tilde. Dark mode inverts the tile and mark and follows tldraw text colors.
- Asset fidelity: the official SVG was used as the measurement source. The requested tilde and new `basdraw` letters are original app branding rather than a copied tldraw logo asset.
- Copy: `basdraw` and `powered by tldraw` match the requested wording.
- Full-view evidence: both corrected 1280 x 720 captures show a coherent themed sidebar and intact canvas UI.
- Focused evidence: the supplied 160 x 64 reference and refined 210 x 64 header capture were opened together and compared at 1x density. The final lockup is intentionally smaller than the source reference following the user's visual correction.

## Runtime checks

- Light and dark theme switching: passed.
- Flat tile with no box shadow: passed.
- Canvas and station state preserved: passed.
- Browser console errors: none.
- `npm run validate`: passed.

## Follow-up polish

- [P3] The official tldraw wordmark is bespoke outlined artwork, so there is no exact font that can spell the additional `b` and `s`. A dedicated original basdraw wordmark could replace the rounded-heavy text later if a standalone brand asset is commissioned.

## Final result

passed
