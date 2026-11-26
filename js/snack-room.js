import { pantryGuideBubble } from './fridge.js';

export const SNACK_DRAWER_SCENE = './assets/snacks/tea-room-drawer.webp';
export const snackSceneSize = { width: 1446, height: 1087 };
// The opening follows the perspective of the actual upper drawer in the illustration.
export const snackDrawerCorners = [[432, 762], [856, 749], [857, 791], [432, 808]];
export const snackDrawerCrop = { x: 432, y: 749, width: 425, height: 59 };

export function renderSnackDrawerRoom() {
  const { width, height } = snackSceneSize;
  const crop = snackDrawerCrop;
  const hitPoints = snackDrawerCorners.map(([x, y]) => [x - crop.x, y - crop.y]);
  const hitShape = hitPoints.map(([x, y]) => `${x / crop.width * 100}% ${y / crop.height * 100}%`).join(',');
  const hitBox = `left:${crop.x / width * 100}%;top:${crop.y / height * 100}%;width:${crop.width / width * 100}%;height:${crop.height / height * 100}%;clip-path:polygon(${hitShape})`;
  return `
    <div class="pantry-heading snack-heading"><h1>零食抽屜</h1></div>
    <section class="snack-room" aria-label="電視下方的零食抽屜">
      <div class="snack-scene">
        <img class="snack-scene-art" src="${SNACK_DRAWER_SCENE}" alt="茶水間裡，木質零食抽屜在電視下方" width="${width}" height="${height}" decoding="async" fetchpriority="high">
        <canvas width="${width}" height="${height}" aria-hidden="true"></canvas>
        <button class="snack-hit" style="${hitBox}" type="button" aria-controls="snack-cabinet" aria-expanded="false" aria-label="拉開電視下方的抽屜">
          <svg class="snack-hit-outline" viewBox="0 0 ${crop.width} ${crop.height}" preserveAspectRatio="none" aria-hidden="true">
            <polygon points="${hitPoints.join(' ')}" vector-effect="non-scaling-stroke"></polygon>
          </svg>
        </button>
        <svg class="snack-guide-arrow" viewBox="0 0 132 112" preserveAspectRatio="none" aria-hidden="true">
          <g class="guide-hand-arrow">
            <path d="M126 9 C76 3 44 16 26 43 C13 64 29 75 44 62 C59 48 16 36 11 94"/>
            <path class="guide-arrow-echo" d="M126 9 C76 3 44 16 26 43 C13 64 29 75 44 62 C59 48 16 36 11 94" transform="translate(.6 .8)"/>
            <path class="guide-arrowhead" d="M4 87 Q9 89 11 93 Q18 86 22 86 L11 104 Z"/>
          </g>
        </svg>
        <button class="snack-guide" type="button" aria-controls="snack-cabinet" aria-expanded="false" aria-label="拉開零食抽屜">
          <svg viewBox="0 0 175 110" aria-hidden="true"><path class="guide-bubble" d="${pantryGuideBubble}"/><text x="85" y="60" text-anchor="middle">拉開零食抽屜</text></svg>
        </button>
      </div>
    </section>
  `;
}
