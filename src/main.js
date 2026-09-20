/**
 * main.js — MindForge app orchestrator
 * Wires together: onboarding, file upload, extraction, AI, rendering, export
 */

import './style.css';
import { extractText, prepareTextForAI } from './extractor.js';
import { generateMindMap } from './ai.js';
import {
  initCanvas, renderMap, toggleLayout, getCurrentLayout,
  zoomIn, zoomOut, resetZoom,
  renderDemoRadial, renderDemoForce,
} from './mindmap.js';
import { exportSVG, exportPNG } from './exporter.js';
import { SnakeGame } from './snake.js';

/* ══════════════════════════════════════════
   STATE
══════════════════════════════════════════ */
let snakeGame = null;
const state = {
  apiKey: '',
  model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  layout: 'radial',
  mapData: null,
  activeMapId: null,
  filename: '',
};

/* ══════════════════════════════════════════
   DOM REFS
══════════════════════════════════════════ */
const $ = id => document.getElementById(id);

// Onboarding
const onboardOverlay   = $('onboarding-overlay');
const stepApiKey       = $('step-apikey');
const stepLayout       = $('step-layout');
const apiKeyInput      = $('api-key-input');
const showKeyBtn       = $('show-key-btn');
const modelSelect      = $('model-select');
const saveKeyBtn       = $('save-key-btn');
const confirmLayoutBtn = $('confirm-layout-btn');

// Main app
const mainApp          = $('main-app');
const uploadZone       = $('upload-zone');
const fileInput        = $('file-input');
const uploadBrowseBtn  = $('upload-browse-btn');
const processingScreen = $('processing-screen');
const processingTitle  = $('processing-title');
const processingBar    = $('progress-bar');
const processingSub    = $('processing-sub');
const processingIcon   = $('processing-icon');
const mapContainer     = $('map-container');
const mapList          = $('map-list');
const mindmapSvg       = $('mindmap-svg');
const nodeDetail       = $('node-detail');
const detailTitle      = $('detail-title');
const detailExcerpt    = $('detail-excerpt');
const detailChildren   = $('detail-children');
const detailIcon       = $('detail-icon');
const settingsPanel    = $('settings-panel');

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
function init() {
  loadFromStorage();
  bindOnboarding();
  bindMainApp();
  bindSettings();

  if (state.apiKey) {
    skipOnboarding();
  } else {
    showOnboarding();
  }
}

function loadFromStorage() {
  // .env vars take priority — set once, always used
  const envKey   = import.meta.env.VITE_OPENROUTER_API_KEY;
  const envModel = import.meta.env.VITE_DEFAULT_MODEL;

  state.apiKey = envKey   || localStorage.getItem('mf_api_key') || '';
  state.model  = envModel || localStorage.getItem('mf_model')   || 'nvidia/nemotron-3-ultra-550b-a55b:free';
  state.layout = localStorage.getItem('mf_layout') || 'radial';

  // If key came from .env, persist it to localStorage so settings panel shows it
  if (envKey)   localStorage.setItem('mf_api_key', envKey);
  if (envModel) localStorage.setItem('mf_model',   envModel);
}

function saveToStorage() {
  localStorage.setItem('mf_api_key', state.apiKey);
  localStorage.setItem('mf_model',   state.model);
  localStorage.setItem('mf_layout',  state.layout);
}

/* ══════════════════════════════════════════
   ONBOARDING FLOW
══════════════════════════════════════════ */
function showOnboarding() {
  onboardOverlay.classList.add('active');
  mainApp.classList.add('hidden');
  stepApiKey.classList.add('active');
  stepLayout.classList.remove('active');
}

function skipOnboarding() {
  onboardOverlay.classList.remove('active');
  mainApp.classList.remove('hidden');
  apiKeyInput.value = state.apiKey;
  syncModelSelects();
  showUploadZone();
}

function bindOnboarding() {
  // API key input validation
  apiKeyInput.addEventListener('input', () => {
    const v = apiKeyInput.value.trim();
    saveKeyBtn.disabled = v.length < 20;
  });

  // Show/hide key
  showKeyBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // Model select
  modelSelect.addEventListener('change', () => { state.model = modelSelect.value; });

  // Save key → move to layout step
  saveKeyBtn.addEventListener('click', () => {
    state.apiKey = apiKeyInput.value.trim();
    state.model  = modelSelect.value;
    saveToStorage();

    stepApiKey.classList.remove('active');
    stepLayout.classList.add('active');

    // Render demos after DOM is ready
    setTimeout(() => {
      renderDemoRadial($('demo-canvas-radial'));
      renderDemoForce($('demo-canvas-force'));
    }, 100);
  });

  // Layout demo selection
  document.querySelectorAll('.layout-demo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-demo-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.layout = btn.dataset.layout;
      confirmLayoutBtn.disabled = false;
    });
  });

  // Confirm layout → enter app
  confirmLayoutBtn.addEventListener('click', () => {
    saveToStorage();
    onboardOverlay.classList.remove('active');
    mainApp.classList.remove('hidden');
    syncModelSelects();
    showUploadZone();
  });
}

/* ══════════════════════════════════════════
   MAIN APP VIEWS
══════════════════════════════════════════ */
function showUploadZone() {
  if (snakeGame) { snakeGame.stop(); snakeGame = null; }
  uploadZone.classList.remove('hidden');
  processingScreen.classList.add('hidden');
  mapContainer.classList.add('hidden');
}

function showProcessing() {
  uploadZone.classList.add('hidden');
  processingScreen.classList.remove('hidden');
  mapContainer.classList.add('hidden');

  const canvas = $('snake-canvas');
  if (canvas) {
    if (snakeGame) snakeGame.stop();
    snakeGame = new SnakeGame(canvas);
    snakeGame.start();
  }
}

function showMap() {
  if (snakeGame) { snakeGame.stop(); snakeGame = null; }
  uploadZone.classList.add('hidden');
  processingScreen.classList.add('hidden');
  mapContainer.classList.remove('hidden');
}

/* ══════════════════════════════════════════
   UPLOAD & PROCESSING
══════════════════════════════════════════ */
function bindMainApp() {
  // Upload zone drag & drop
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  uploadBrowseBtn.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('click', e => {
    if (e.target === uploadZone || e.target.closest('.upload-inner')) {
      if (!e.target.closest('button')) fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
    fileInput.value = '';
  });

  // Nav controls
  $('nav-layout-toggle').addEventListener('click', () => {
    if (!state.mapData) return;
    const newLayout = toggleLayout();
    state.layout = newLayout;
    saveToStorage();
    $('nav-layout-toggle').textContent = newLayout === 'radial' ? '⊙ Radial' : '⊙ Force';
  });
  $('nav-export-svg').addEventListener('click', () => exportSVG(mindmapSvg, state.filename || 'mindmap'));
  $('nav-export-png').addEventListener('click', () => exportPNG(mindmapSvg, state.filename || 'mindmap'));
  $('nav-settings').addEventListener('click', () => settingsPanel.classList.toggle('hidden'));

  // Zoom controls
  $('btn-zoom-in').addEventListener('click', zoomIn);
  $('btn-zoom-out').addEventListener('click', zoomOut);
  $('btn-reset-zoom').addEventListener('click', resetZoom);

  // Node detail panel close
  $('close-detail').addEventListener('click', () => nodeDetail.classList.add('hidden'));

  // Sidebar buttons
  $('btn-regenerate').addEventListener('click', () => {
    if (!state.mapData) return;
    // Re-render current map (resets positions)
    const map = state.mapData.maps.find(m => m.id === state.activeMapId);
    if (map) renderActiveMap(map);
  });
  $('btn-new-doc').addEventListener('click', () => {
    state.mapData = null;
    state.activeMapId = null;
    showUploadZone();
    nodeDetail.classList.add('hidden');
  });

  // Click outside node detail to close
  mindmapSvg.addEventListener('click', () => nodeDetail.classList.add('hidden'));
}

async function handleFile(file) {
  if (!state.apiKey) {
    alert('Please set your OpenRouter API key in Settings (⚙).');
    settingsPanel.classList.remove('hidden');
    return;
  }

  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'docx', 'doc'].includes(ext)) {
    showError(`Unsupported file: .${ext}. Please use PDF or Word (.docx)`);
    return;
  }

  state.filename = file.name.replace(/\.[^.]+$/, '');
  showProcessing();

  try {
    // Step 1: Extract text
    const { text } = await extractText(file, updateProgress);
    updateProgress('Getting it ready for Nemotron…', 80);

    if (!text || text.trim().length < 50) {
      throw new Error('Could not extract enough text from the document. Is it a scanned PDF without text layer?');
    }

    // Step 2: Trim for AI token limits
    const aiText = prepareTextForAI(text);

    // Step 3: Generate mind maps via AI
    updateProgress('AI is analysing your document…', 83);
    const data = await generateMindMap(aiText, state.apiKey, state.model, updateProgress);

    state.mapData = data;

    // Step 4: Render
    updateProgress('Putting pen to paper…', 98);
    await new Promise(r => setTimeout(r, 200));

    initCanvas(mindmapSvg, state.layout, handleNodeClick);
    buildMapSidebar(data.maps);
    activateMap(data.maps[0]);
    showMap();

  } catch (err) {
    console.error(err);
    showError(err.message || 'Something went wrong. Please try again.');
    showUploadZone();
  }
}

function updateProgress(msg, pct) {
  // Fade out → change → fade in
  processingTitle.style.opacity = '0.4';
  setTimeout(() => {
    processingTitle.textContent = msg;
    processingTitle.style.opacity = '1';
  }, 150);

  if (processingBar) processingBar.style.width = `${pct}%`;

  // Icon changes as stages progress
  if (processingIcon) {
    if (pct < 78)       processingIcon.textContent = '\uD83D\uDCD6'; // 📖
    else if (pct < 84)  processingIcon.textContent = '\u270F\uFE0F'; // ✏️
    else if (pct < 96)  processingIcon.textContent = '\uD83E\uDD14'; // 🤔
    else                processingIcon.textContent = '\uD83D\uDDFA\uFE0F'; // 🗺️
  }

  // Restart the wave drawing animation
  const wavePath = document.querySelector('.wave-path');
  if (wavePath) {
    wavePath.style.animation = 'none';
    void wavePath.offsetWidth; // trigger reflow
    wavePath.style.animation = '';
  }
}

function showError(msg, type = 'error') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

/* ══════════════════════════════════════════
   MAP SIDEBAR
══════════════════════════════════════════ */
const TAB_COLORS = ['#4f8ef7','#7b5ef8','#2ccfb0','#f5a623','#7ed957','#f75f7a','#e0a3ff'];

function buildMapSidebar(maps) {
  mapList.innerHTML = '';
  maps.forEach((map, i) => {
    const btn = document.createElement('button');
    btn.className = 'map-tab';
    btn.dataset.mapId = map.id;

    const dot = document.createElement('span');
    dot.className = 'map-tab-dot';
    dot.style.background = TAB_COLORS[i % TAB_COLORS.length];

    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(map.title || map.id));
    btn.addEventListener('click', () => activateMap(map));
    mapList.appendChild(btn);
  });
}

function activateMap(map) {
  state.activeMapId = map.id;

  // Update sidebar active state
  document.querySelectorAll('.map-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mapId === map.id);
  });

  // Close detail panel on map change
  nodeDetail.classList.add('hidden');

  renderActiveMap(map);
}

function renderActiveMap(map) {
  renderMap(map, state.layout);
  setTimeout(resetZoom, 200);
}

/* ══════════════════════════════════════════
   NODE CLICK → DETAIL PANEL
══════════════════════════════════════════ */
function handleNodeClick(nodeData) {
  detailIcon.textContent    = nodeData.icon  || '●';
  detailTitle.textContent   = nodeData.label || '';
  detailExcerpt.textContent = nodeData.excerpt || 'No description available.';

  detailChildren.innerHTML = '';
  (nodeData.children || []).forEach(child => {
    const chip = document.createElement('span');
    chip.className = 'child-chip';
    chip.textContent = (child.icon || '') + ' ' + (child.label || '');
    chip.title = child.excerpt || '';
    chip.addEventListener('click', () => handleNodeClick(child));
    detailChildren.appendChild(chip);
  });

  nodeDetail.classList.remove('hidden');
}

/* ══════════════════════════════════════════
   SETTINGS PANEL
══════════════════════════════════════════ */
function bindSettings() {
  const settingsApiKey    = $('settings-api-key');
  const settingsShowKey   = $('settings-show-key');
  const settingsModel     = $('settings-model-select');
  const settingsSaveBtn   = $('settings-save-btn');
  const closeSettings     = $('close-settings');

  closeSettings.addEventListener('click', () => settingsPanel.classList.add('hidden'));

  settingsShowKey.addEventListener('click', () => {
    settingsApiKey.type = settingsApiKey.type === 'password' ? 'text' : 'password';
  });

  $('nav-settings').addEventListener('click', () => {
    // Sync current values into settings panel
    settingsApiKey.value = state.apiKey;
    syncModelSelects();
  });

  settingsSaveBtn.addEventListener('click', () => {
    const key   = settingsApiKey.value.trim();
    const model = settingsModel.value;
    if (key.length < 20) { showError('API key looks too short. Check it and try again.'); return; }
    state.apiKey = key;
    state.model  = model;
    saveToStorage();
    settingsPanel.classList.add('hidden');
    showError('\u2713 Settings saved!', 'success');
  });
}

function syncModelSelects() {
  [modelSelect, $('settings-model-select')].forEach(sel => {
    if (sel) {
      sel.value = state.model;
      // If model not in list, default
      if (!sel.value) sel.value = 'mistralai/mistral-7b-instruct:free';
    }
  });
}

/* ══════════════════════════════════════════
   BOOT
══════════════════════════════════════════ */
init();
