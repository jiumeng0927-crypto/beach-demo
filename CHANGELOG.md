# Changelog

## 0.48.0 - 2026-09-15

- Add three rotating sets of NPC-authored coastal orders, giving collected items a higher-value directed-delivery path alongside immediate bulk sale.
- Add per-NPC affinity and aggregate community reputation. Award affinity only on the first meeting per coastal day and on successful delivery; unlock four reputation tiers with future order bonuses.
- Make delivery an atomic collection-campaign transaction with inventory, quantity, reward and duplicate validation. Preserve the actual paid reward so later reputation changes cannot rewrite completed-order history.
- Integrate orders into both NPC conversation and the market panel, with publisher, requirement, affordability, completion and next-reputation-level feedback across desktop and mobile.
- Persist relationships, daily greetings and paid orders in a separately validated local save. Rotate daily state with the natural coastal clock while retaining long-term relationships across days and refreshes.
- Extend deterministic and browser regression coverage through real NPC-directed delivery, remaining bulk sale, purchase, reload and relationship-state verification. Add the corresponding learning guide and manual-upload production snapshot.

## 0.47.0 - 2026-09-15

- Add a persistent daily coastal commission board with three deterministic rotations covering tides, collection, trade, billiards, weather movement and camera bookmarks.
- Route real discovery, transaction, shot, pocket and bookmark events into task progress. Count sold item quantities, ignore cue-ball pockets and require grounded movement for rain patrol time.
- Add explicit reward claiming through the existing tide-coin economy, with bounded progress, duplicate-claim protection, corrupt-storage fallback and refresh-safe logical day continuity.
- Extend the collection dialog to accessible peer tabs for journal, market and commissions. Show live progress/rewards on desktop and mobile, and let the shopkeeper open either market or commission view.
- Fix the generic NPC chat branch so text-only visitors cannot reference an undefined local item.
- Add deterministic commission tests and a desktop/mobile end-to-end path for low tide, billiards shots, sunset bookmark, persistence and reward claiming. Export the manual-upload web snapshot and learning guide.

## 0.46.0 - 2026-09-15

- Connect all 18 beach discoveries to a persistent local economy. Collected sea glass, shells and litter enter an inventory that can be sold for tide coins; purchases include a distance clue, future sale bonus and collectible pin.
- Add a dedicated journal/market view and a shopkeeper conversation that opens it. Validate purchases, balances and inventory before saving; migrate version-one discovery saves without losing found sites.
- Expand the living scene from six to ten visitors with a shopkeeper, cafe attendant, cleanup volunteer and beach walker. Keep four shared source GLBs, independent animation state, interaction, collision and mobile nearest-four visibility budgeting.
- Remove the empty green backland, decorative leaf field, long road tails and exposed outer sand tongues shown in review screenshots. Keep only the 104-unit shop street and the authored playable beach.
- Sink the sealed terrain skirt below side sightlines and add two four-triangle ocean horizon wings. Preserve exact coast stitching while removing diagonal water edges in elevated along-shore views.
- Add deterministic economy, migration, finite-street, NPC market-flow, horizon-wing and desktop/mobile visual regressions. Export the updated manual-upload web snapshot and learning guide.

## 0.45.0 - 2026-09-15

- Keep four slatted loungers and the rescue lookout, but remove the oversized fabric-roof lounge and two duplicate parasols after visual review. Reduce random grass, pebbles and shells so beach routes and landmarks remain readable.
- Rebalance all time-of-day presets with gentler direct sunlight, stronger sky fill, lower flat ambient light and slightly higher exposure. Tighten the directional shadow camera and soften high-quality shadows while retaining ACES tone mapping and PCF soft shadows.
- Close shop gables; add side windows, fascia, downpipes, awning posts, counters and display shelves. Reanchor imported street props and their collision/vegetation bounds when quality changes.
- Rebudget tiny shell/lifering meshes with unchanged PBR maps, and use tight-box culling for non-shadow-casting street objects rather than oversized bounding spheres.
- Replace bare backland behind the shops with a raised green boundary and 18 instanced leaf clusters. Retain a sealed ground surface and the original playable coast.
- Expand visitors from two to six, including two sidewalk patrols that pause for conversations and nearby walkers. Derive two lightweight rigged GLBs, share source geometry/materials with independent skeletons, and retain original quests.
- Reduce low-quality grass and roof/road subdivisions to offset street content. Keep the existing frame budgets; compare lantern culling under identical lighting instead of unrelated day/dawn shadow frusta.
- Add an inland coastal street with three shopfronts, pitched roofs, awnings, signs, opaque PBR glazing, emissive night windows, benches and lamps. Preserve the authored beach and gameplay layout.
- Add a curved two-lane road with shader-painted markings, a crossing, shoulders and a beach access path. Share sampled road/apron geometry with walking height, clear vegetation locally, add shop/bench/lamp collisions, and extend inland navigation to Z=87.
- Import two CC0 Poly Haven assets: an outdoor table/chair set and planter box. Prepare bounded GLBs in Blender, keep local hashes and provenance, reuse the established loader, palette treatment and lifecycle.
- Add Settings > Coastal Street framing without resetting the game. Correct output-space ocean haze ordering, reorient swapped normal detail, filter subpixel ripples and limit whitecaps to windy, steep crests.
- Add street geometry/grounding/collision/lifecycle checks and desktop/mobile day/night screenshots. Keep manual web upload and source/publication separation.

## 0.44.0 - 2026-09-14

- Continue in the user's Beach demo Git repository. Separate dev.html from the tracked index.html publication snapshot; add export:web for the explicitly retained manual upload workflow, without deletion or network publication.
- Reconstruct upsampled window depth explicitly to remove mobile shoreline bands. Include the outer seabed in refraction capture and add a GPU planar-depth interpolation regression.

- Continue the original beach/seabed perimeter with four sparse outer rings, matching every boundary vertex and normal without modifying central terrain, foam diagonals, props or movement limits.
- Extend only distant ocean samples to 3600 units with unchanged vertex counts; compute actual adjacent spacing for wave filtering and update culling bounds.
- Blend the visible sky horizon into renderer-managed fog, respecting output color space, weather, time changes and render targets. The separate HDR lighting scene remains unchanged.
- Add deterministic stitching, topology, coverage, near-water density and budget checks plus desktop/mobile four-direction screenshots, runtime ray coverage and exactly-once quality-switch disposal.

## 0.43.0 - 2026-09-14

- Default to observation; only explicit shooting mode arms the cue and strike controls. Observation supports orbit/zoom even when dragging the white ball.
- Latch direction at pointerdown and suspend all cue-camera interpolation during the pull. Horizontal motion and fine-aim changes cannot rotate a latched stroke.
- Cancel capture on mode changes, Escape, blur and pointer cancellation. Successful shots return to observation without a camera snap; placement/rulings use overview and never auto-arm.
- Replace synthetic tonal impacts with Za-Games' CC0 billiard recording and disclosed cue/rail/pocket derivatives. Package locally with SHA256, bounded lazy decode, retry, timeout and disposal guards.
- Add desktop/mobile observation, fixed-camera, cancellation and actual decoded-audio checks. Retain table geometry, collisions, spin, cloth and beach layout.

## 0.42.0 - 2026-09-13

- Added white-ball-centered low aiming camera, overview switching, touch/mouse yaw and pull gestures, fine direction and power controls; freeze camera during shots and return to overview for placement/rulings.
- Added locally synthesized cue, ball, cushion and pocket audio from actual physics events; lazy gesture unlock, strength/distance/stereo response, mute/volume, bounded voices, compression and explicit teardown.
- Refined table with beveled wood, six supported legs, levelers, inlays, hardware, leather pocket bags and sloped cushion tops; preserved physical noses, pocket mouths, rules and cloth dynamics.
- Removed moire-prone cloth stripes and added a visible multi-part cue with spin offsets and visual-only cushion clearance. Mobile aiming HUD no longer covers the white ball.
- Added deterministic and desktop/mobile presentation checks including rendered audio, camera/geometry correspondence, actual input and disposal. Beach layout, collection campaign and atmosphere retained.

## 0.41.0 - 2026-09-13

- Folded grass blades and palm leaflets, aligned/tapered ringed trunks and quality-specific vegetation detail; preserved landmark layout.
- Replaced line gulls with instanced bodies and feathered wings, continuous flight paths, banking and alternating flapping/gliding.
- Refined both existing CC0 visitors in Blender, retaining authored rig/clips and adding MIT clothing accessories; reduced mesh cost after subdivision.
- Added an 18-site, three-chapter collection campaign, low-tide gates, journal, badges, NPC progression and validated local saves. Chapter visuals are released when replaced.
- Added a frame-independent continuous 30-minute day cycle with pause and period seeking. Visible clouds now evolve independently of wind; removed baked HDR clouds from the visible sky while retaining HDR illumination.
- Added deterministic campaign/clock tests and desktop/mobile rendering, interaction, save/reload and disposal checks; documented explicit new model budgets and approximation limits.

## 0.40.0 - 2026-09-12

- Rebuilt near-shore foam from the actual beach vertex rows and matching triangle diagonals, preventing mismatched terrain interpolation.
- Added advancing crests, broken foam residue and retreat, using only water time so pausing waves freezes all swash detail; added explicit fog uniforms.
- Corrected double-darkened grass colors, curved and tapered blades, with three segments at high quality and two at low quality. Preserved instance counts and placement/clearance rules.
- Replaced finite-difference sand bumps with filtered analytic noise gradients; preserved macro terrain normals and the PBR unperturbed-normal input.
- Added desktop/mobile swash pixel, pause, terrain-conformance, color and disposal checks plus learning documentation. No scene-layout/gameplay changes, new assets or dependencies.

## 0.39.0 - 2026-09-12

- Added a verified CC0 pure-sky HDRI shared by the visible sky, planar water reflections and PBR environment lighting, with analytical fallback.
- Rebalanced Gerstner waves, antialiased fine normals, absorption/scattering, crest lighting and roughness; softened zero-depth Fresnel coverage to remove bright shoreline triangles.
- Redistributed the existing ocean mesh toward the near shore. Increased high reflection to 1024 and refraction long-edge limits to 1536/768, with explicit pixel-cost accounting.
- Replaced the unverified legacy normal with the byte-verified original Three.js r160 texture; retained the depth-mask and normal-offset fixes.
- Added same-camera desktop/mobile water comparisons, runtime asset hashes, HDR fallback/disposal and root/subpath production tests. Added portable browser selection and CI configuration.
- Applied the user-approved MIT license to original code; separated third-party notices and allowlisted production assets. No remote repository has been published.
- Updated learning records, including remaining single-layer/planar-reflection and model-detail limitations. No UE parity claim.

## 0.38.0

- Linked imported/fallback rock wetness to tide height, preserving PBR maps and material ownership.
- Relocated seeded grass instances using transformed prop bounds and wind margins without changing counts or accumulating drift.
- Linked distant sailboat height to tide and rocking to water time; retained visual-only buoyancy.
- Added desktop/mobile material-pixel, vegetation-clearance, rebind and fallback checks.

## 0.32.0 - 2026-09-09

### Added

- Replaced six-ball practice with local two-player Chinese eight-ball, using the explicitly documented CBSA January 2017 rule baseline.
- Added 16 numbered balls, solids/stripes atlas, regulation relative ball/playing dimensions, triangular rack, cloth markings and a wood-framed table.
- Added post-break group assignment, legal-contact/rail checks, turns, foul placement, illegal-break options, opening-eight respotting, and black-eight win/loss settlement.
- Added pure rule scenarios and 30 physical pocket shots across five frame rates, plus real desktop/mobile ball-in-hand input coverage.

### Improved

- Refined existing boat hull and recessed cabin, merged ribs/floor planks, curved chair fabric and supporting frame, canopy braces and surface folds. Preserved all landmark transforms and disabled character loading.
- Check pocket crossings between 240 Hz physics steps, cap catch-up at 12 steps, and collect a complete shot before adjudicating the result.
- Kept balls instanced and disposed the numbered atlas and cloth texture explicitly.
- Excluded overlapping DOM overlays from canvas-only regression screenshots; retained the existing bloom pixel thresholds.
- Updated learning guides and delivery documentation. No jump/spin simulation, online play or tournament-certification claim.

## 0.31.0 - 2026-09-08

### Fixed

- Fixed stationary cue-ball taps firing a shot by measuring drag from the original press position and filtering small pointer jitter.
- Cancel aiming on lost capture, pointer cancellation, focus loss, hidden pages, context loss, and camera transitions; prevent a second pointer from replacing the active drag.
- Keep retrying a scratched cue ball after the delay expires and choose a clear nearby position when its opening spot is occupied.
- Emit the settled-state transition so the HUD returns to ready, and disallow additional shots after completion.
- Refresh instance bounds after ball movement so the cue remains selectable away from its opening position.
- Correct the early-load table focus coordinates and register the previously missing billiards title icon.

### Learning and Verification

- Added real mouse and touch browser coverage for tap, drag, cancellation, camera control ownership, consecutive shots, and scratch recovery.
- Expanded deterministic regression coverage for occupied respawns, event transitions, pointer capture, and completed games.
- Removed unsupported CCD assignments and corrected the learning guide: cannon-es 0.20.0 uses the configured fixed-step discrete solver and speed cap here, not the CCD described in the old 0.28.0 entry.
- Updated the billiards learning guide and package version to `0.31.0`.

## 0.30.0 - 2026-09-08

### Added

- Added a dedicated locate button to the beach billiards HUD.
- Added responsive desktop and mobile camera compositions that keep the complete table in view.
- Added browser assertions for the real HUD action, orbit-mode transition, tween completion, final camera coordinates, accessible label, toast, and table framing.

### Improved

- Reused the existing orbit camera tween so locating the table stays smooth and also exits walk or free mode cleanly.
- Reduced the billiards heading spacing so both icon controls remain stable in the compact mobile HUD.
- Updated the billiards learning guide and project usage notes for the new camera workflow.
- Updated the project package version to `0.30.0`.

## 0.29.0 - 2026-09-07

### Added

- Added dynamic camera-collider registration and removal to the existing beach world collision map.
- Added a table-sized collider that keeps walk and free cameras outside the beach billiards table.
- Added deterministic collider dimensions and browser-level collision resolution coverage.

### Improved

- Re-register the same billiards collider after High/Low world rebuilds without accumulating duplicates.
- Reused the existing low-cost box collision solver and velocity response instead of adding mesh raycasts or a second collision implementation.
- Updated the billiards and production learning guides for dynamic scene-object collision ownership.
- Updated the project package version to `0.29.0`.

## 0.28.0 - 2026-09-07

### Added

- Added a playable beach billiards table with drag aiming, variable shot power, six pockets, scoring, fouls, cue-ball respawn, completion, and reset.
- Added lazy-loaded `cannon-es` physics with fixed-step sphere collisions, rail restitution, damping, sleep, CCD, and planar constraints.
- Added a compact responsive billiards HUD and a dedicated learning guide for physics, input, instancing, events, and resource lifecycle.
- Added deterministic billiards tests and desktop/mobile browser coverage for shot, pocket, reset, rendering, reuse, and disposal.

### Improved

- Preserved all existing beach landmarks and moved the table to an unobstructed dry-sand area after desktop and mobile visual review.
- Paused all character runtime importing, allocation, animation, and rendering while retaining the Blender sources, GLB assets, generator, and guide for later final-model integration.
- Kept the billiards table to four normal draw objects and five while aiming, and excluded the group from the Water mirror pass.
- Verified complete regression totals at 101 draw calls and 141,663 triangles on Desktop High, and 47 draw calls and 52,062 triangles on Mobile Low.
- Updated the project package version to `0.28.0`.

## 0.27.0 - 2026-08-29

### Added

- Added editable Blender 4.5 sources and a repeatable headless generation script for both supplied chibi character references.
- Added two local GLB character assets with separate head and arm pivots for procedural idle animation.
- Added GLB geometry, triangle, material, animation-node, reuse, shadow, and disposal coverage to the deterministic and browser tests.

### Improved

- Replaced the interim camera-facing turnaround planes with true 3D models that receive scene lighting and cast desktop shadows.
- Baked the character palette into vertex colors and reduced the runtime to eight meshes, eight draw objects, two PBR materials, and 11,694 triangles.
- Kept both characters out of the Water reflection pass and lazy-loaded their GLB assets only after entering the scene.
- Verified final render totals at 111 draw calls and 161,895 triangles on Desktop High, and 55 draw calls and 63,756 triangles on Mobile Low.
- Updated the project package version to `0.27.0`.

## 0.26.0 - 2026-08-29

### Added

- Added two built-in two-head-tall chibi characters derived from the supplied front, side, and back references.
- Added lightweight idle, breathing, arm-sway, head-tilt, and waving motion without per-frame allocations.
- Added a dedicated character lifecycle test and desktop/mobile visual coverage for placement, reuse, rendering, and disposal.

### Improved

- Merged character parts into eight vertex-colored meshes and reduced the final character geometry to about 9,280 triangles.
- Deferred all character Geometry and Material creation until the scene is entered.
- Excluded characters from the Water mirror pass while preserving scene shadows and time-of-day lighting.
- Repositioned both characters so they remain discoverable in desktop and narrow mobile compositions without blocking gameplay landmarks.
- Updated the project package version to `0.26.0`.

## 0.25.0 - 2026-08-29

### Added

- Added exact discovery geometry, instance-matrix, instance-color, and glow-attribute resource accounting.
- Added deterministic and browser lifecycle coverage for first-entry allocation, reuse, reflection registration, and disposal.

### Improved

- Deferred all “潮汐拾光” Mesh, Points, Geometry, Material, and instance attributes until the first scene entry.
- Removed 8,328 bytes of unused discovery attributes from the opening screen while preserving the six-site gameplay and visuals.
- Reused the same discovery resources across enabled-state toggles and quality changes.
- Updated the project package version to `0.25.0`.

## 0.24.0 - 2026-08-29

### Added

- Added centralized High and Low celestial payload accounting for moon textures, moon geometry, halo texture, and star positions.
- Added celestial initialization, allocation, resident-byte, scene-membership, and resource-linkage debug data.
- Added deterministic payload checks and desktop/mobile lifecycle coverage from daylight through first night, quality switching, reuse, and disposal.

### Improved

- Deferred all star vertices, moon texture and geometry, and moon-halo texture until the first time their original opacity becomes visible.
- Deferred 364,952 measurable payload bytes on High or 147,112 bytes on Low from the default daylight startup.
- Kept dawn, daylight, and sunset at zero celestial payload while preserving their original appearance and render counts.
- Reused the same celestial objects and resources after returning from night, avoiding repeated allocation across time-of-day changes.
- Preserved deterministic stars, procedural moon detail, night composition, High/Low replacements, and explicit final disposal.
- Updated the project package version to `0.24.0`.

## 0.23.0 - 2026-08-23

### Added

- Added centralized High and Low rain resource profiles with exact resident-memory and GPU-attribute accounting.
- Added rain initialization, allocation, release, byte, and resource-linkage debug data.
- Added deterministic lifecycle checks and desktop/mobile browser coverage for lazy creation, reuse, reflection registration, and disposal.

### Improved

- Deferred all rain arrays, BufferGeometry, Material, and LineSegments until the default-off effect is first enabled.
- Deferred 184,800 resident bytes and 158,400 GPU attribute bytes on High, or 87,360 and 74,880 bytes on Low.
- Reused the same rain resources across ordinary off/on toggles without duplicate allocation.
- Released obsolete rain resources when quality changes while disabled and deferred the replacement until the next enable.
- Synchronized Water reflection exclusions whenever a rain LineSegments object is created, replaced, or released.
- Preserved rain density, wind lean, terrain and water impacts, splash rendering, scene composition, and one-Draw-Call enabled cost.
- Updated the project package version to `0.23.0`.

## 0.22.0 - 2026-08-23

### Added

- Added one shared atmospheric visibility threshold for stars, moon, moon halo, and lantern lighting.
- Added lantern active, flicker, object visibility, intensity, opacity, transition, draw-object, and identity data.
- Added deterministic threshold checks and frozen-frame desktop/mobile daylight-culling coverage.

### Improved

- Culled the zero-intensity PointLight, transparent glow Mesh, and transparent halo Sprite during full daylight.
- Skipped lantern sine flicker and scale updates while its visual contribution is below the visibility threshold.
- Reduced the desktop default daylight view by 2 Draw Calls and 170 triangles with zero sampled pixel difference.
- Removed the daylight PointLight from mobile light collection even when its glow geometry was already outside the camera frustum.
- Preserved dawn, sunset, and night lantern intensity, glow, halo, flicker, identities, and scene placement.
- Updated the project package version to `0.22.0`.

## 0.21.0 - 2026-08-23

### Added

- Added centralized High `950` and Low `480` star-point profiles.
- Added real star count, position-buffer size, object identity, revision, replacement, disposal, visibility, and linkage data.
- Added deterministic star profile tests and desktop/mobile browser geometry lifecycle and daylight-culling coverage.

### Improved

- Made runtime quality changes replace the star BufferGeometry while reusing its Points object and PointsMaterial.
- Reduced Low star points and position-buffer bytes by about 49% without changing the night-scene Draw Call count.
- Culled fully transparent stars, moon, and moon halo during dawn and day so Water reflection and main-scene passes skip them.
- Disposed every obsolete star geometry and cleared the final geometry reference during teardown.
- Replaced timing-only browser waits with observable animation and quality-state completion checks.
- Updated the project package version to `0.21.0`.

## 0.20.0 - 2026-08-23

### Added

- Added High `28×20` and Low `18×12` moon sphere segment profiles.
- Added real moon vertex, triangle, geometry identity, geometry disposal, and profile linkage data.
- Extended deterministic and desktop/mobile browser checks to cover the complete moon geometry lifecycle.

### Improved

- Made runtime quality changes replace both the moon CanvasTexture and SphereGeometry while reusing its Mesh and Material.
- Reduced Low moon geometry from 1,064 to 396 triangles, about 63%, without changing Draw Calls or scene composition.
- Disposed every obsolete moon geometry and cleared the final geometry reference during teardown.
- Updated the project package version to `0.20.0`.

## 0.19.0 - 2026-08-23

### Added

- Added centralized High and Low procedural moon texture profiles.
- Added runtime moon texture size, crater count, object identity, revision, replacement, disposal, and linkage data.
- Added deterministic moon profile tests and desktop/mobile browser texture lifecycle coverage.

### Improved

- Made runtime quality changes replace the moon material map with a real `256×256` or `128×128` CanvasTexture.
- Reduced Low moon texture pixel area by 75% and crater count from 46 to 23.
- Preserved the moon mesh, material, position, opacity, color, night state, and scene identity across switches.
- Disposed every obsolete moon texture and cleared the final material map during teardown.
- Updated the project package version to `0.19.0`.

## 0.18.0 - 2026-08-23

### Added

- Added centralized High and Low Water normal texture profiles.
- Added runtime normal size, anisotropy, source identity, active identity, revision, replacement, disposal, and linkage data.
- Added deterministic profile tests and desktop/mobile browser texture lifecycle coverage.

### Improved

- Made runtime quality changes replace Water's `normalSampler` with a real `512×512` or `256×256` texture.
- Reduced Low normal texture pixel area by 75% and anisotropy from 8× to 4×.
- Preserved one read-only source image, the Water mesh, accumulated time, swell phase, tide, weather, and shader state across switches.
- Disposed every obsolete active texture and both remaining normal resources during teardown.
- Updated the project package version to `0.18.0`.

## 0.17.0 - 2026-08-16

### Added

- Added centralized High and Low Water reflection RenderTarget profiles.
- Added captured target size, pixel count, identity, revision, resize, and linkage data to debug state.
- Added deterministic reflection profile tests and desktop/mobile browser lifecycle coverage.

### Improved

- Made runtime quality changes resize the existing Water reflection target to `512×512` or `256×256`.
- Reduced Low reflection pixel area by 75% without changing scene geometry or Draw Calls.
- Preserved the Water mesh, texture identity, accumulated time, swell phase, tide, and shader state across switches.
- Explicitly disposed the captured RenderTarget during experience teardown.
- Updated the project package version to `0.17.0`.

## 0.16.0 - 2026-08-16

### Added

- Added centralized High and Low procedural-cloud resource profiles.
- Added runtime cloud quality state with real texture, segment, triangle, phase, revision, and disposal data.
- Added deterministic profile tests and desktop High → Low → High resource lifecycle coverage.
- Added dedicated desktop Low and High quality screenshots.

### Improved

- Made runtime quality changes replace the cloud density DataTexture and cloud-dome geometry instead of retaining startup resources.
- Preserved cloud phase, rotation, opacity, weather colors, and sun direction across replacements.
- Disposed obsolete cloud Geometry, Material, and Texture resources after every successful switch.
- Reduced Low cloud texture area by 75% and cloud-dome triangles by about 67% without changing Draw Calls.
- Updated the project package version to `0.16.0`.

## 0.15.0 - 2026-08-16

### Added

- Added one shared coastal-wind controller for clouds, dune grass, palm fronds, and rain streaks.
- Added a smoothed `0.00-1.20` wind-strength control with `0.60` preserving the authored default motion.
- Added wind target, effective strength, factor, phase, and rain drift data to debug state.
- Added deterministic wind tests and frozen desktop/mobile calm-versus-strong browser coverage.

### Improved

- Replaced four independent hard-coded wind clocks and amplitudes with one allocation-free frame state.
- Kept existing cloud uniforms, grass uniforms, palm instance matrices, and rain line buffers.
- Added no scene objects, geometry, Draw Calls, triangles, textures, network assets, or runtime dependencies.
- Updated the project package version to `0.15.0`.

## 0.14.0 - 2026-08-16

### Added

- Added an optional high-threshold cinematic bloom control for water glints, moonlight, lanterns, and discovery highlights.
- Added a lazy `RenderPass -> UnrealBloomPass -> OutputPass` pipeline with separate High and Low profiles.
- Added deterministic lazy-loading, quality, failure, render-path, and disposal tests.
- Added frozen-frame desktop/mobile bloom comparisons and real toggle regression coverage.

### Improved

- Preserved the original direct renderer path and zero post-processing module requests while bloom is disabled.
- Included the complete Composer chain in existing GPU timing and auto-quality measurement.
- Restored baseline Draw Calls and triangles immediately after disabling bloom.
- Updated the project package version to `0.14.0`.

## 0.13.0 - 2026-08-16

### Added

- Added two analytical low-frequency slopes to the distant Water surface normal.
- Added a near-shore world-space fade and a `0.00-1.00` swell-strength control.
- Added deterministic shader-injection checks and frozen-frame desktop/mobile pixel comparisons.
- Added detailed per-invariant diagnostics for the browser swell regression.

### Improved

- Reused the existing Water time uniform and preserved the authored shoreline behavior.
- Added no geometry, Draw Calls, triangles, texture samples, network assets, or runtime dependencies.
- Kept the default strength at `0.42` with precise `0.01` control steps.
- Updated the project package version to `0.13.0`.

## 0.12.0 - 2026-08-16

### Added

- Added three persistent camera composition bookmark slots.
- Added save, smooth restore, slot selection, overwrite, and delete controls.
- Added validated versioned localStorage data with in-memory fallback.
- Added deterministic persistence tests and complete desktop/mobile browser workflows.

### Improved

- Reused the existing camera tween for bookmark restoration.
- Kept time, weather, tide, quality, gameplay, imports, and scene content independent.
- Added no scene objects, Draw Calls, triangles, textures, or runtime dependencies.
- Updated the project package version to `0.12.0`.

## 0.11.0 - 2026-08-16

### Added

- Added optional procedural footstep audio for first-person walking.
- Added separate filtered sand and timber boardwalk sound profiles.
- Added exact boardwalk surface classification using the existing authored surface samples.
- Added deterministic audio lifecycle tests and desktop/mobile browser assertions.

### Improved

- Kept audio muted and completely uninitialized until the user enables it.
- Triggered steps from actual grounded travel distance with stop and teleport protection.
- Added no scene objects, Draw Calls, triangles, textures, network assets, or runtime dependencies.
- Updated the project package version to `0.11.0`.

## 0.10.0 - 2026-08-16

### Added

- Added an optional dawn time preset with low-angle warm light and exponential mist.
- Added coordinated dawn Sky, fog, Water, cloud, sand, foam, and PBR lighting values.
- Added a fourth responsive time segment while keeping Day selected by default.
- Added dawn lighting and fog colors to debug state.
- Added desktop and mobile dawn screenshots and regression assertions.

### Improved

- Kept weather layering, tide, rain, wave phase, gameplay, and imported assets independent of the new preset.
- Preserved the original default Day scene and the existing render budget.
- Added no geometry, Draw Calls, triangles, textures, or runtime dependencies.
- Updated the project package version to `0.10.0`.

## 0.9.0 - 2026-08-16

### Added

- Added non-blocking whole-frame GPU timing with `EXT_disjoint_timer_query_webgl2`.
- Added bounded query queues, disjoint invalidation, timeout cleanup, and context restoration.
- Added GPU timing, queue, validity, pressure, and auto-quality reason data to debug state.
- Added deterministic timer lifecycle tests and desktop/mobile browser assertions.

### Improved

- Made Auto quality consider both five-second average FPS and smoothed GPU frame time.
- Preserved the existing FPS-only behavior when timer queries are unavailable.
- Added no scene objects, Draw Calls, triangles, textures, or runtime dependencies.
- Updated the project package version to `0.9.0`.

## 0.8.0 - 2026-08-16

### Added

- Added a shared Water wave phase uniform to the shoreline foam shader.
- Added phase-driven swash travel, crest broadening, and opposing backwash strength.
- Added linked phase, speed, travel, strength, and shader status to the foam debug state.
- Added desktop and mobile regression coverage for 1.20x and 0.20x wave speeds.
- Added dedicated desktop and mobile wave-foam screenshots.

### Improved

- Made the wave-speed control drive Water and shoreline foam from one accumulated clock.
- Kept the existing noise breakup while adding about 0.91 metres of visible swash travel.
- Added no geometry, Draw Calls, triangles, textures, or runtime dependencies.
- Stabilized weather performance snapshots after one-off PMREM generation.
- Updated the project package version to `0.8.0`.

## 0.7.0 - 2026-08-14

### Added

- Added independent clear, cloudy, and overcast atmosphere presets.
- Added a weather segmented control to the scene settings panel.
- Added weather coverage, cloud opacity, lighting, fog, exposure, reflection, and glint data to debug state.
- Added desktop and mobile weather regression assertions and overcast screenshots.

### Improved

- Layered weather over the existing time-of-day presets so every combination transitions smoothly.
- Kept the clear profile neutral, preserving the original default scene exactly.
- Kept weather independent from rain, tide, scene objects, and imported assets.
- Added no geometry, Draw Calls, triangles, or runtime dependencies for weather switching.
- Updated the project package version to `0.7.0`.

## 0.6.0 - 2026-08-14

### Added

- Added terrain- and water-aware rain impact detection.
- Added two short directional splash jets for every rain impact.
- Added active-splash, impact, segment, and buffer-capacity data to debug state.
- Added desktop and mobile regression assertions for splash activity and six vertices per drop.

### Improved

- Packed streak and splash segments into the existing dynamic `LineSegments` buffer.
- Kept the complete rain effect at one optional Draw Call and zero triangles.
- Collapse expired splash vertices and clear all contact state when rain is disabled.
- Replaced flat cross-shaped impacts with smaller, upward splash jets after visual review.
- Updated the project package version to `0.6.0`.

## 0.5.0 - 2026-08-14

### Added

- Added X/Z placement, horizontal rotation, and 0.5-2.00 scale controls for imported assets.
- Added terrain-aware grounding whenever an imported model or texture board moves.
- Added one-click placement reset and transform data in debug state.
- Added desktop and mobile regression coverage for texture and animated-model transforms.
- Added dedicated placement screenshots for both tested viewports.

### Improved

- Apply user transforms to the imported outer group so glTF animation nodes remain intact.
- Preserve the texture board's camera-facing base rotation while exposing a clear rotation offset.
- Hide placement controls until a local asset is loaded and reset state on replacement or removal.
- Updated the project package version to `0.5.0`.

## 0.4.0 - 2026-08-14

### Added

- Added an animation clip menu for imported glTF and GLB models.
- Added play/pause, restart, and 0.25-2.00 playback-speed controls.
- Added 0.35-second cross-fading when switching between animation clips.
- Added animation clip, playback, speed, and action-time data to debug state.
- Added desktop and mobile regression coverage using a generated two-clip glTF model.

### Improved

- Hide animation controls for textures and static models so the default scene remains unchanged.
- Stop actions and uncache the imported animation root during replacement, removal, and disposal.
- Updated the project package version to `0.4.0`.

## 0.3.0 - 2026-08-14

### Added

- Added an independently switchable 3D rain volume with high/low quality density tiers.
- Added local PNG, JPEG, WebP, and AVIF texture import into a scene display board.
- Added local GLB and embedded glTF import with automatic grounding and normalization.
- Added imported model animation playback, shadow integration, complexity limits, and deterministic disposal.
- Added model/texture/remove controls, busy state, validation feedback, and debug state.
- Added browser regression coverage for rain, texture import, glTF import, and removal.
- Added `docs/RAIN_AND_IMPORT_GUIDE.md`.

### Improved

- Kept rain at one optional Draw Call and excluded it from Water's mirror pass.
- Deferred `GLTFLoader` into a dedicated lazy chunk loaded only after model import.
- Preserved the original scene and its baseline render budget while optional systems are inactive.
- Updated the project package version to `0.3.0`.

## 0.2.1 - 2026-08-14

### Added

- Added one-click Windows start and stop entry points for both source and finished web packages.
- Added a dependency-free loopback static server with health, status, and authenticated stop endpoints.
- Added automatic port fallback, detached background operation, and repeated-launch process reuse.
- Added MIME, HEAD, ETag, byte-range, SPA fallback, and traversal-rejection server coverage.
- Added `docs/LOCAL_DELIVERY_GUIDE.md` and an end-user text guide inside the finished package.

### Improved

- Production builds now include every file needed for local one-click startup.
- Local delivery no longer depends on keeping a Vite terminal window open.
- Updated the project package version to `0.2.1`.

## 0.2.0 - 2026-08-14

### Added

- Added low, automatic, and high tide modes to the scene settings.
- Added a 180-second automatic tide cycle with smoothed manual transitions.
- Synchronized Water height, wet-sand shoreline, foam position, and walk boundary.
- Added tide status to the desktop scene HUD and debug state.
- Added desktop and mobile tide regression coverage and high-tide screenshots.
- Added `docs/TIDE_SYSTEM_GUIDE.md`.

### Improved

- Expanded the ocean plane so high tide cannot reveal its near-shore edge.
- Preserved tide state when runtime quality changes rebuild the beach world.
- Kept tide updates allocation-free and added no new render calls.
- Updated the project package version to `0.2.0`.

### Security

- Updated transitive `nanoid` to `3.3.18` and `postcss` to `8.5.26`.
- `npm audit` reports zero known vulnerabilities.
