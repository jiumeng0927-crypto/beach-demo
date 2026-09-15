import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { verifiedPublicFiles } from './public-assets.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
if (existsSync(resolve(projectRoot, 'dist/dev.html'))) {
  renameSync(resolve(projectRoot, 'dist/dev.html'), resolve(projectRoot, 'dist/index.html'));
}
const files = [
  ...verifiedPublicFiles().map((name) => [`public/${name}`, `dist/${name}`]),
  ['LICENSE', 'dist/LICENSE'],
  ['THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.md'],
  ['node_modules/three/LICENSE', 'dist/licenses/three.txt'],
  ['node_modules/cannon-es/LICENSE', 'dist/licenses/cannon-es.txt'],
  ['node_modules/lucide/LICENSE', 'dist/licenses/lucide.txt'],
  ['scripts/local-server.mjs', 'dist/scripts/local-server.mjs'],
  ['delivery/web/启动网页.cmd', 'dist/启动网页.cmd'],
  ['delivery/web/停止网页.cmd', 'dist/停止网页.cmd'],
  ['delivery/web/使用说明.txt', 'dist/使用说明.txt'],
  ['docs/THIRD_PARTY_COASTAL_ASSETS.md', 'dist/模型素材与许可.md'],
  ['docs/OCEAN_AND_NPC_GUIDE.md', 'dist/水体与NPC学习记录及许可.md'],
  ['docs/WATER_QUALITY_039.md', 'dist/水体质感学习记录.md'],
  ['docs/NEAR_SHORE_FINISH_040.md', 'dist/近岸细节学习记录.md'],
  ['docs/LIVING_COAST_041.md', 'dist/海岸生态与玩法学习记录.md'],
  ['docs/BILLIARDS_PRESENTATION_042.md', 'dist/台球视听与建模学习记录.md'],
  ['docs/BILLIARDS_INTERACTION_043.md', 'dist/台球状态与锁镜学习记录.md'],
  ['docs/SCENE_BOUNDARIES_044.md', 'dist/场景边界学习记录.md'],
  ['docs/COASTAL_STREET_045.md', 'dist/海滨街区学习记录.md'],
  ['docs/COASTAL_MARKET_046.md', 'dist/拾光交易与场景收敛学习记录.md'],
  ['docs/MANUAL_PUBLISH.md', 'dist/手动发布说明.md'],
];

for (const [source, destination] of files) {
  const sourcePath = resolve(projectRoot, source);
  const destinationPath = resolve(projectRoot, destination);
  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
}

console.log('Prepared one-click local web package files.');
