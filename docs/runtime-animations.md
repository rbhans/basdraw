# Data-driven animation runtime

The saved drawing describes intent. Live point snapshots supply inputs. Runtime presentation is disposable and never writes animated coordinates back into tldraw records. Native camera navigation remains separate.

## Responsibilities

- `behaviorDefinitions.ts` owns effect categories and conflict channels. Multiple points and effects are allowed when their channels do not conflict; labels can repeat.
- `runtimeMapping.ts` converts snapshots and binding configuration into target presentation. Keep this evaluation pure.
- `RuntimeAnimationController.ts` owns time, numeric interpolation and continuous phase. It has no React, DOM or station dependency.
- `runtimeAnimationHooks.ts` attaches one controller to each editor's `tick` event. Subscriptions release on unmount; the final subscriber releases the clock listener.
- `RuntimeMotion.tsx` supplies HTML/SVG adapters for shared spin and travel cycles. Shape wrappers, fills and labels project presentation into their own coordinate systems.
- `bindingScope.ts` resolves group inheritance, channel ownership and pivots.

## Timing contract

Each active continuous binding has a stable owner-scoped ID. Its consumers share phase, including late-mounted consumers. Speed edits preserve phase. When the last consumer leaves, the cycle is discarded; a subsequently enabled cycle starts at rest. Spin is linear; travel eases out and back. Seconds are physical durations, not multiplied by the editor animation-speed preference. A zero preference disables motion.

Numeric targets arrive immediately on first mount, then interpolate over 180ms. A new reading retargets from the currently displayed value, not the previous endpoint. Labels display the actual point reading without interpolating text. Numeric subscribers paint only while transitioning; continuous subscribers paint each tick. Frames do not cause React state updates. React still responds to snapshots and document edits.

Project page-space vectors at paint time. Do not tween zoom-dependent pixels: camera and geometry changes should reproject immediately, not start another transition. Keep rotation and scale pivots independent. Labels follow movement but remain upright.

## Adding an effect

1. Define validated options and migration/default behavior with the existing binding schema. Preserve unsupported saved effects.
2. Add its catalog entry, editor controls and explicit conflict channel. Use a new channel only when effects can truly compose.
3. Map the point to a target in the pure evaluator. For continuous behavior, retain the binding ID and define a sampler in `runtimeCycles` if spin/travel cannot express it.
4. Add presentation adapters only where needed. Reuse the controller rather than adding another timer, requestAnimationFrame loop, CSS animation or per-element Web Animation.
5. Test mapping, composition, retargeting, reduced motion, cleanup, and any HTML/SVG/group coordinate behavior.

New shape libraries should use the same binding/runtime path. A future connection adapter should deliver point snapshots, not implement animations.

## Verification and limits

Run `node --test scripts/runtime-animation.test.mjs` and `npm run validate`. The isolated `/scripts/behavior-qa.html` offers **Add motion fixture**, synthetic point changes and **Check saved geometry**; it has no saved canvas or station connection. `/scripts/canvas-regression.html` covers existing canvas contracts.

This is a consistent extension boundary, not a large-drawing performance guarantee. Snapshot subscription indexing and representative many-shape benchmarks remain future work. Native selection bounds still reflect saved artwork; use Live effects off when arranging it.
