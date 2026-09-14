import {
  Box,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Volume2,
  VolumeX,
  CircleDot,
  CircleHelp,
  Crosshair,
  Eye,
  createIcons,
  Footprints,
  Gem,
  Info,
  ImageUp,
  Keyboard,
  LocateFixed,
  Maximize,
  MessagesSquare,
  Minimize,
  Mouse,
  Move3d,
  Pause,
  Play,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide';

import './styles.css';
import { BeachExperience } from './experience/BeachExperience.js';
import { UIController } from './ui/UIController.js';

// Lucide replaces only the icons used by this interface, keeping the icon
// bundle separate from the Three.js rendering chunks.
createIcons({
  icons: {
    Box,
    BookOpen,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Volume2,
    VolumeX,
    CircleDot,
    Crosshair,
    Eye,
    CircleHelp,
    Footprints,
    Gem,
    Info,
    ImageUp,
    Keyboard,
    LocateFixed,
    Maximize,
    MessagesSquare,
    Minimize,
    Mouse,
    Move3d,
    Pause,
    Play,
    RotateCcw,
    Save,
    SlidersHorizontal,
    Trash2,
    X,
  },
});

const app = document.querySelector('#app');
const canvas = document.querySelector('#scene-canvas');
const ui = new UIController(document);
const experience = new BeachExperience(canvas, {
  onProgress: (progress) => ui.setLoadingProgress(progress),
});

ui.connect(experience);

try {
  // Core scene resources are ready before the intro becomes interactive.
  // Entry-only gameplay visuals are created synchronously by enter().
  await experience.init();
  app.setAttribute('aria-busy', 'false');
  ui.setReady();
} catch (error) {
  console.error('Beach experience failed to start:', error);
  app.setAttribute('aria-busy', 'false');
  ui.showFallback();
}

window.__TIDELINE__ = {
  experience,
  getState: () => experience.getDebugState(),
};

window.addEventListener(
  'pagehide',
  (event) => {
    // A persisted page may return from the back/forward cache and should retain
    // its WebGL state; a real unload releases every owned resource.
    if (event.persisted) return;
    ui.dispose();
    experience.dispose();
  },
  { once: true },
);
