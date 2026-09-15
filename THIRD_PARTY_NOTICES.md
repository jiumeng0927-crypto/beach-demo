# Third-Party Notices

The root MIT license covers original project code and documentation. It does
not relicense third-party assets or dependencies.

| Component | Author | License | Provenance |
| --- | --- | --- | --- |
| Billiard ball clack (public HQ MP3 preview) | Za-Games | CC0-1.0 | [Author/source](https://freesound.org/people/Za-Games/sounds/539854/), [manifest](public/audio/billiards/manifest.json), [license](https://creativecommons.org/publicdomain/zero/1.0/) |
| Six coastal GLB assets | Poly Haven contributors | CC0-1.0 | [Asset manifest](public/models/coastal/manifest.json), [credits](docs/THIRD_PARTY_COASTAL_ASSETS.md) |
| Outdoor table/chair set and planter box | James Ray Cock / Poly Haven | CC0-1.0 | [Manifest](public/models/street/manifest.json), [table/chairs](https://polyhaven.com/a/outdoor_table_chair_set_01), [planter](https://polyhaven.com/a/planter_box_01), [license](https://polyhaven.com/license) |
| Two casual NPC bases and two lightweight crowd derivatives | Quaternius; coastal modifications by this project | CC0-1.0; authored modifications MIT | [Manifest](public/models/npc/manifest.json), [source](https://quaternius.com/packs/ultimatedanimatedcharacter.html) |
| Coastal pure-sky HDRI | Greg Zaal, Jarod Guest | CC0-1.0 | [Source](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), [manifest](public/textures/manifest.json) |
| Water normal texture | Three.js authors | MIT | [Unmodified r160 source](https://github.com/mrdoob/three.js/blob/r160/examples/textures/waternormals.jpg), [manifest](public/textures/manifest.json) |
| Three.js | Three.js authors | MIT | Installed package LICENSE, [upstream](https://github.com/mrdoob/three.js/blob/r160/LICENSE) |
| cannon-es | cannon-es contributors | MIT | Installed package LICENSE |
| Lucide | Lucide contributors; Feather-derived icons by Cole Bemis | ISC / MIT | Installed package LICENSE |

Asset bytes are checked with SHA-256. The public build only copies the listed
runtime assets. Original character reference images, Blender experiments and
the unverified legacy `water-normal.jpg` stay local and are not licensed by
this project or included in the public build. The active normal is the
byte-verified official Three.js file, not a relabeled legacy texture.

Version 0.41 modifies the Quaternius visitors with subdivision, decimation,
smooth normals and new hats, bag, straps, sunglasses and shoes. Original
character geometry/rig/animation remains CC0. Newly authored accessory geometry
and preparation code are covered by the root MIT license. The manifest's
`license` field names the source license; `modificationsLicense` names MIT for
the additions. Rebuilding the GLB updates its checksum without replacing the
original-source checksum.

## Billiards Recording

The billiards recording is packaged unmodified. Runtime processing trims the
onset, removes DC and applies filters, envelopes and levels. Cue, rail and pocket
sounds are designed derivatives of the ball recording, not separate recordings
or sounds authored from scratch. No external audio request is made at runtime.

## Three.js MIT Notice

Copyright (c) 2010-2023 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
