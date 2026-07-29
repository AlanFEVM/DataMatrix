const $ = (selector) => document.querySelector(selector);

const elements = {
  grid: $('#matrixGrid'),
  canvas: $('#canvas'),
  gridWrap: $('#gridWrap'),
  minimap: $('#minimap'),
  minimapCanvas: $('#minimapCanvas'),
  favoritesList: $('#favoritesList'),
  favoritesCount: $('#favoritesCount'),
  tree: $('#matrixTree'),
  breadcrumbs: $('#breadcrumbs'),
  title: $('#matrixTitle'),
  meta: $('#matrixMeta'),
  saveState: $('#saveState'),
  addPopover: $('#addPopover'),
  cellMenu: $('#cellMenu'),
  matrixMenu: $('#matrixMenu'),
  matrixContextMenu: $('#matrixContextMenu'),
  editor: $('#editorDialog'),
  editorForm: $('#editorForm'),
  editorEyebrow: $('#editorEyebrow'),
  editorTitle: $('#editorTitle'),
  titleInput: $('#cellTitleInput'),
  valueInput: $('#cellValueInput'),
  valueField: $('#valueField'),
  valueLabel: $('#valueLabel'),
  editorHint: $('#editorHint'),
  saveCellBtn: $('#saveCellBtn'),
  tableDialog: $('#tableDialog'),
  tableForm: $('#tableForm'),
  tableTitleInput: $('#tableTitleInput'),
  tableSummary: $('#tableSummary'),
  tableGrid: $('#tableGrid'),
  markdownDialog: $('#markdownDialog'),
  markdownForm: $('#markdownForm'),
  markdownTitleInput: $('#markdownTitleInput'),
  markdownInput: $('#markdownInput'),
  markdownPreview: $('#markdownPreview'),
  markdownStats: $('#markdownStats'),
  appearanceDialog: $('#appearanceDialog'),
  appearanceForm: $('#appearanceForm'),
  appearancePreview: $('#appearancePreview'),
  appearancePreviewIcon: $('#appearancePreviewIcon'),
  appearancePreviewTitle: $('#appearancePreviewTitle'),
  matrixAppearanceDialog: $('#matrixAppearanceDialog'),
  matrixAppearanceForm: $('#matrixAppearanceForm'),
  matrixAppearancePreview: $('#matrixAppearancePreview'),
  matrixAppearancePreviewIcon: $('#matrixAppearancePreviewIcon'),
  matrixAppearancePreviewTitle: $('#matrixAppearancePreviewTitle'),
  themePanel: $('#themePanel'),
  scrim: $('#scrim'),
  toastRegion: $('#toastRegion')
};

let state;
let saveTimer;
let saveFeedbackTimer;
let targetCell = null;
let editorContext = null;
let tableContext = null;
let tableDraft = null;
let markdownContext = null;
let appearanceContext = null;
let appearanceDraft = null;
let matrixAppearanceContext = null;
let matrixAppearanceDraft = null;
let treeContextMatrixId = null;
let swapDrag = null;
let panDrag = null;
let minimapDrag = null;
let draggedMatrixId = null;
let minimapMetrics = null;
let minimapFrame = null;
const thumbnailCache = new Map();
const appIconCache = new Map();

const TABLE_TYPES = {
  text: { label: '文本', input: 'text' },
  number: { label: '数字', input: 'number' },
  date: { label: '日期', input: 'date' },
  boolean: { label: '布尔值', input: 'checkbox' },
  url: { label: '网址', input: 'url' }
};

const MATRIX_ICONS = new Set(['panels-top-left', 'layout-grid', 'folder', 'database', 'briefcase-business', 'code-2', 'image', 'music', 'calendar-days', 'book-open', 'target', 'lightbulb', 'rocket', 'archive', 'palette']);

const uid = () => crypto.randomUUID();
const cellKey = (row, col) => `${row}:${col}`;

function createMatrix(title = '未命名矩阵', parentId = null, rows = 3, cols = 4) {
  return {
    id: uid(),
    title,
    parentId,
    rows,
    cols,
    cells: {},
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function defaultState() {
  const root = createMatrix('我的数据矩阵');
  return {
    version: 1,
    activeMatrixId: root.id,
    matrices: { [root.id]: root },
    favorites: [],
    matrixFavorites: [],
    settings: { mode: 'light', accent: '#2f7d68', colorful: true, cellColorMode: 'type', minimapVisible: true, collapsedMatrices: [] }
  };
}

function normalizeState(value) {
  if (!value || value.version !== 1 || !value.matrices || !Object.keys(value.matrices).length) return defaultState();
  if (!value.matrices[value.activeMatrixId]) value.activeMatrixId = Object.keys(value.matrices)[0];
  const previousSettings = value.settings || {};
  value.settings = { mode: 'light', accent: '#2f7d68', colorful: true, cellColorMode: previousSettings.colorful === false ? 'accent' : 'type', minimapVisible: true, collapsedMatrices: [], ...previousSettings };
  if (!['type', 'cascade', 'accent'].includes(value.settings.cellColorMode)) value.settings.cellColorMode = 'type';
  if (!Array.isArray(value.settings.collapsedMatrices)) value.settings.collapsedMatrices = [];
  value.favorites = Array.isArray(value.favorites) ? value.favorites : [];
  value.matrixFavorites = Array.isArray(value.matrixFavorites)
    ? Array.from(new Set(value.matrixFavorites.filter((id) => typeof id === 'string' && value.matrices[id])))
    : [];
  Object.values(value.matrices).forEach((matrix) => {
    matrix.cells ||= {};
    matrix.rows = Math.max(1, Number(matrix.rows) || 3);
    matrix.cols = Math.max(1, Number(matrix.cols) || 4);
    if (matrix.appearance) {
      const color = validCellColor(matrix.appearance.color) ? matrix.appearance.color : '';
      const icon = MATRIX_ICONS.has(matrix.appearance.icon) ? matrix.appearance.icon : '';
      if (color || icon) matrix.appearance = { ...(color ? { color } : {}), ...(icon ? { icon } : {}) };
      else delete matrix.appearance;
    }
    Object.values(matrix.cells).forEach((cell) => {
      if (cell && !cell.id) cell.id = uid();
    });
  });
  return value;
}

function activeMatrix() {
  return state.matrices[state.activeMatrixId];
}

function touch(matrix = activeMatrix()) {
  matrix.updatedAt = Date.now();
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  clearTimeout(saveFeedbackTimer);
  elements.saveState.textContent = '正在保存…';
  elements.saveState.classList.add('visible');
  saveTimer = setTimeout(async () => {
    try {
      await window.matrixAPI.saveWorkspace(state);
      elements.saveState.textContent = '已保存';
    } catch (error) {
      elements.saveState.textContent = '保存失败';
      toast('工作区保存失败，请检查磁盘权限', true);
    }
    saveFeedbackTimer = setTimeout(() => elements.saveState.classList.remove('visible'), 1300);
  }, 320);
}

function refreshIcons() {
  window.lucide?.createIcons({ attrs: { 'stroke-width': 1.8 } });
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function validCellColor(color) {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
}

function cellIconContent(cell, fallbackIcon) {
  if (cell.appearance?.emoji) return `<span class="cell-emoji">${escapeHtml(cell.appearance.emoji)}</span>`;
  if (cell.type === 'file' && !isImageFile(cell.value)) {
    return `<img class="system-app-icon" data-app-icon="${encodeURIComponent(cell.value)}" alt=""><i class="app-icon-fallback" data-lucide="${fallbackIcon}"></i>`;
  }
  return `<i data-lucide="${fallbackIcon}"></i>`;
}

function fileName(filePath) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function fileExtension(filePath) {
  const name = fileName(filePath);
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toUpperCase() : '文件';
}

function fileIcon(filePath) {
  const ext = fileExtension(filePath).toLowerCase();
  if (['exe', 'app', 'msi', 'bat', 'cmd', 'lnk'].includes(ext)) return 'app-window';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'sheet';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (['mp3', 'wav', 'flac', 'aac'].includes(ext)) return 'audio-lines';
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return 'film';
  if (['js', 'ts', 'html', 'css', 'py', 'java', 'json'].includes(ext)) return 'file-code-2';
  return 'file';
}

function isApplicationFile(filePath) {
  return ['exe', 'app', 'msi', 'bat', 'cmd', 'lnk'].includes(fileExtension(filePath).toLowerCase());
}

function isImageFile(filePath) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff'].includes(fileExtension(filePath).toLowerCase());
}

function pathToMatrix(matrixId) {
  const path = [];
  const seen = new Set();
  let current = state.matrices[matrixId];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? state.matrices[current.parentId] : null;
  }
  return path;
}

function matrixIconName(matrix, nested = false) {
  return MATRIX_ICONS.has(matrix?.appearance?.icon) && matrix.appearance.icon
    ? matrix.appearance.icon
    : nested ? 'layout-grid' : 'panels-top-left';
}

function render() {
  renderTree();
  renderFavorites();
  renderHeader();
  renderGrid();
  refreshIcons();
}

function renderTree() {
  const children = new Map();
  Object.values(state.matrices).forEach((matrix) => {
    const parent = matrix.parentId && state.matrices[matrix.parentId] ? matrix.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(matrix);
  });
  children.forEach((items) => items.sort((a, b) => a.createdAt - b.createdAt));

  const rows = [];
  const collapsed = new Set(state.settings.collapsedMatrices);
  const append = (parentId, depth, ancestorGuides = []) => {
    const siblings = children.get(parentId) || [];
    siblings.forEach((matrix, index) => {
      const childCount = (children.get(matrix.id) || []).length;
      const hasChildren = childCount > 0;
      const hasNext = index < siblings.length - 1;
      const isCollapsed = hasChildren && collapsed.has(matrix.id);
      const guides = ancestorGuides.map((visible, level) => visible ? `<span class="tree-guide" data-guide-level="${level}"></span>` : '').join('');
      const connector = depth ? `<span class="tree-connector ${hasNext ? 'continues' : ''}"></span>` : '';
      const toggle = hasChildren
        ? `<button class="tree-toggle ${isCollapsed ? 'collapsed' : ''}" data-tree-toggle="${matrix.id}" aria-label="${isCollapsed ? '展开' : '折叠'} ${escapeHtml(matrix.title)}" aria-expanded="${!isCollapsed}" title="${isCollapsed ? '展开矩阵' : '折叠矩阵'}"><i data-lucide="chevron-down"></i></button>`
        : '<span class="tree-toggle-spacer"></span>';
      const favorite = isMatrixFavorite(matrix.id);
      const hasColor = validCellColor(matrix.appearance?.color);
      rows.push(`<div class="tree-row ${depth ? 'nested' : 'root'} ${hasColor ? 'has-matrix-color' : ''}" data-depth="${depth}" data-tree-matrix-id="${matrix.id}">${guides}${connector}${toggle}<button class="tree-item ${matrix.id === state.activeMatrixId ? 'active' : ''}" data-matrix-id="${matrix.id}" draggable="true" title="${escapeHtml(matrix.title)}"><span class="tree-matrix-icon"><i data-lucide="${matrixIconName(matrix, depth > 0)}"></i></span><span class="tree-label">${escapeHtml(matrix.title)}</span>${hasChildren ? `<span class="tree-count">${childCount}</span>` : ''}</button><button class="tree-favorite ${favorite ? 'active' : ''}" data-matrix-favorite="${matrix.id}" aria-label="${favorite ? '取消收藏' : '收藏'} ${escapeHtml(matrix.title)}" aria-pressed="${favorite}" title="${favorite ? '取消收藏矩阵' : '收藏矩阵'}"><i data-lucide="star"></i></button></div>`);
      if (!isCollapsed) append(matrix.id, depth + 1, [...ancestorGuides, hasNext]);
    });
  };
  append(null, 0);
  elements.tree.innerHTML = rows.join('');
  elements.tree.querySelectorAll('.tree-row').forEach((row) => {
    const depth = Number(row.dataset.depth);
    row.style.setProperty('--indent', `${depth * 16}px`);
    row.style.setProperty('--branch-indent', `${Math.max(0, depth - 1) * 16}px`);
    row.style.setProperty('--tree-delay', `${Math.min(depth * 22, 110)}ms`);
    const matrix = state.matrices[row.dataset.treeMatrixId];
    if (validCellColor(matrix?.appearance?.color)) row.style.setProperty('--tree-color', matrix.appearance.color);
  });
  elements.tree.querySelectorAll('[data-guide-level]').forEach((guide) => {
    guide.style.setProperty('--guide-indent', `${Number(guide.dataset.guideLevel) * 16}px`);
  });
}

function findCellById(cellId) {
  if (!cellId) return null;
  for (const matrix of Object.values(state.matrices)) {
    for (const [key, cell] of Object.entries(matrix.cells)) {
      if (cell?.id !== cellId) continue;
      const [row, col] = key.split(':').map(Number);
      return { matrix, matrixId: matrix.id, key, row, col, cell };
    }
  }
  return null;
}

function isFavorite(cellId) {
  return state.favorites.includes(cellId);
}

function removeFavorite(cellId) {
  state.favorites = state.favorites.filter((id) => id !== cellId);
}

function removeFavorites(cells) {
  const removedIds = new Set(cells.filter(Boolean).map((cell) => cell.id).filter(Boolean));
  if (removedIds.size) state.favorites = state.favorites.filter((id) => !removedIds.has(id));
}

function isMatrixFavorite(matrixId) {
  return state.matrixFavorites.includes(matrixId);
}

function removeMatrixFavorite(matrixId) {
  state.matrixFavorites = state.matrixFavorites.filter((id) => id !== matrixId);
}

function syncMatrixFavoriteAction(matrixId = state.activeMatrixId) {
  const button = $('#favoriteMatrixAction');
  const active = isMatrixFavorite(matrixId);
  button.classList.toggle('favorite-active', active);
  button.setAttribute('aria-pressed', String(active));
  button.querySelector('span').textContent = active ? '取消收藏矩阵' : '收藏矩阵';
}

function toggleMatrixFavorite(matrixId) {
  const matrix = state.matrices[matrixId];
  if (!matrix) return;
  if (isMatrixFavorite(matrixId)) {
    removeMatrixFavorite(matrixId);
    toast('已取消收藏矩阵');
  } else {
    state.matrixFavorites.push(matrixId);
    toast('矩阵已添加到收藏栏');
  }
  scheduleSave();
  renderTree();
  renderFavorites();
  syncMatrixFavoriteAction(matrixId);
  refreshIcons();
}

function favoriteIcon(cell) {
  if (cell.type === 'file') return fileIcon(cell.value);
  return ({ link: 'globe-2', matrix: 'grid-2x2', table: 'table-2', markdown: 'file-text', text: 'type' })[cell.type] || 'box';
}

function renderFavorites() {
  const resolved = state.favorites.map(findCellById).filter(Boolean);
  if (resolved.length !== state.favorites.length) state.favorites = resolved.map((item) => item.cell.id);
  const favoriteMatrices = state.matrixFavorites.map((id) => state.matrices[id]).filter(Boolean);
  if (favoriteMatrices.length !== state.matrixFavorites.length) state.matrixFavorites = favoriteMatrices.map((matrix) => matrix.id);
  elements.favoritesCount.textContent = String(resolved.length + favoriteMatrices.length);
  if (!resolved.length && !favoriteMatrices.length) {
    elements.favoritesList.innerHTML = '<div class="favorites-empty">暂无收藏</div>';
    return;
  }

  const matrixItems = favoriteMatrices.map((matrix, index) => {
    const color = validCellColor(matrix.appearance?.color)
      ? matrix.appearance.color
      : state.settings.cellColorMode === 'cascade' ? cascadeCellColor(index, 0, 4) : themeColor('--matrix');
    const path = pathToMatrix(matrix.id);
    const location = path.length > 1 ? path.slice(0, -1).map((item) => item.title).join(' / ') : `${matrix.rows} × ${matrix.cols}`;
    return `<div class="favorite-item-row favorite-matrix-row"><button class="favorite-item" data-favorite-matrix-id="${matrix.id}" title="进入 ${escapeHtml(matrix.title)}"><span class="favorite-symbol" data-favorite-color="${escapeHtml(color)}"><i data-lucide="${matrixIconName(matrix)}"></i></span><span class="favorite-item-copy"><strong>${escapeHtml(matrix.title)}</strong><small>矩阵 · ${escapeHtml(location)}</small></span></button><button class="icon-button favorite-remove" data-matrix-favorite-remove="${matrix.id}" aria-label="取消收藏 ${escapeHtml(matrix.title)}" title="取消收藏"><i data-lucide="x"></i></button></div>`;
  }).join('');

  const cellItems = resolved.map(({ cell, matrix, row, col }) => {
    const color = cellDisplayColor(cell, row, col, matrix.cols);
    const symbol = cell.appearance?.emoji
      ? escapeHtml(cell.appearance.emoji)
      : `<i data-lucide="${favoriteIcon(cell)}"></i>`;
    return `<div class="favorite-item-row"><button class="favorite-item" data-favorite-id="${escapeHtml(cell.id)}" title="打开 ${escapeHtml(cell.title || '未命名数据')}"><span class="favorite-symbol" data-favorite-color="${escapeHtml(color)}">${symbol}</span><span class="favorite-item-copy"><strong>${escapeHtml(cell.title || '未命名数据')}</strong><small>${escapeHtml(matrix.title)} · ${row + 1}, ${col + 1}</small></span></button><button class="icon-button favorite-remove" data-favorite-remove="${escapeHtml(cell.id)}" aria-label="取消收藏 ${escapeHtml(cell.title || '未命名数据')}" title="取消收藏"><i data-lucide="x"></i></button></div>`;
  }).join('');
  elements.favoritesList.innerHTML = matrixItems + cellItems;
  elements.favoritesList.querySelectorAll('[data-favorite-color]').forEach((symbol) => {
    symbol.style.setProperty('--favorite-color', symbol.dataset.favoriteColor);
  });
}

function syncFavoriteAction(cell) {
  const button = $('#favoriteCellAction');
  const active = Boolean(cell?.id && isFavorite(cell.id));
  button.classList.toggle('favorite-active', active);
  button.setAttribute('aria-pressed', String(active));
  button.querySelector('span').textContent = active ? '取消收藏' : '收藏';
}

function toggleFavorite(cell) {
  if (!cell?.id) return;
  if (isFavorite(cell.id)) {
    removeFavorite(cell.id);
    toast('已取消收藏');
  } else {
    state.favorites.push(cell.id);
    toast('已添加到收藏栏');
  }
  scheduleSave();
  renderFavorites();
  syncFavoriteAction(cell);
  refreshIcons();
}

async function openFavorite(cellId) {
  const found = findCellById(cellId);
  if (!found) {
    removeFavorite(cellId);
    scheduleSave();
    renderFavorites();
    return;
  }
  const treeChanged = revealMatrixInTree(found.matrixId);
  if (state.activeMatrixId !== found.matrixId || treeChanged) {
    state.activeMatrixId = found.matrixId;
    scheduleSave();
    render();
  }
  targetCell = { row: found.row, col: found.col };
  const selected = elements.grid.querySelector(`.matrix-cell[data-row="${found.row}"][data-col="${found.col}"]`);
  selected?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  selected?.classList.add('favorite-focus');
  setTimeout(() => selected?.classList.remove('favorite-focus'), 1100);
  await handleCellAction(found.cell);
}

function renderHeader() {
  const matrix = activeMatrix();
  elements.title.value = matrix.title;
  const filled = Object.values(matrix.cells).filter(Boolean).length;
  elements.meta.textContent = `${matrix.rows} 行 × ${matrix.cols} 列 · ${filled} 个数据项`;
  elements.breadcrumbs.innerHTML = pathToMatrix(matrix.id).map((item, index, list) => {
    const separator = index < list.length - 1 ? '<i data-lucide="chevron-right"></i>' : '';
    return `<button class="breadcrumb" data-matrix-id="${item.id}">${escapeHtml(item.title)}</button>${separator}`;
  }).join('');
}

function cellMarkup(cell) {
  if (!cell) return '<div class="empty-content"><span>+</span><span>添加数据</span></div>';

  if (cell.type === 'file' && isImageFile(cell.value)) {
    const encodedPath = encodeURIComponent(cell.value);
    return `<span class="cell-accent"></span><img class="cell-thumbnail" data-thumbnail="${encodedPath}" alt=""><span class="thumbnail-shade"></span><div class="cell-top thumbnail-top"><span class="cell-icon">${cellIconContent(cell, 'image')}</span><button class="icon-button cell-more" data-cell-menu aria-label="单元格操作" title="单元格操作"><i data-lucide="ellipsis"></i></button></div><div class="thumbnail-copy"><h3 class="cell-title">${escapeHtml(cell.title || fileName(cell.value))}</h3><p class="cell-subtitle">${escapeHtml(fileExtension(cell.value))}</p></div>`;
  }

  let icon = 'type';
  let subtitle = '自定义数据';
  let preview = '';
  if (cell.type === 'file') {
    icon = fileIcon(cell.value);
    subtitle = fileExtension(cell.value);
  } else if (cell.type === 'link') {
    icon = 'globe-2';
    try { subtitle = new URL(cell.value).hostname; } catch { subtitle = '网页链接'; }
  } else if (cell.type === 'matrix') {
    const nested = state.matrices[cell.matrixId];
    icon = matrixIconName(nested, true);
    subtitle = nested ? `${nested.rows} × ${nested.cols} · 双击进入` : '矩阵不可用';
  } else if (cell.type === 'table') {
    icon = 'table-2';
    const table = cell.value || { columns: [], rows: [] };
    subtitle = `${table.columns?.length || 0} 列 × ${table.rows?.length || 0} 行`;
    preview = `<p class="cell-content-preview table-columns-preview">${escapeHtml((table.columns || []).map((column) => column.name).join(' · ') || '空数据表')}</p>`;
  } else if (cell.type === 'markdown') {
    icon = 'file-text';
    const markdown = String(cell.value || '');
    subtitle = `Markdown · ${markdown.length} 字符`;
    preview = `<p class="cell-content-preview">${escapeHtml(markdownPlainText(markdown) || '空文档')}</p>`;
  } else {
    preview = `<p class="cell-content-preview">${escapeHtml(cell.value || '空内容')}</p>`;
  }

  return `<span class="cell-accent"></span><div class="cell-top"><span class="cell-icon">${cellIconContent(cell, icon)}</span><button class="icon-button cell-more" data-cell-menu aria-label="单元格操作" title="单元格操作"><i data-lucide="ellipsis"></i></button></div><h3 class="cell-title">${escapeHtml(cell.title || '未命名')}</h3><p class="cell-subtitle">${escapeHtml(subtitle)}</p>${preview}`;
}

function renderGrid() {
  const matrix = activeMatrix();
  elements.grid.style.gridTemplateColumns = `32px repeat(${matrix.cols}, 190px)`;
  const cells = ['<div class="grid-corner" aria-hidden="true"></div>'];
  for (let col = 0; col < matrix.cols; col += 1) {
    cells.push(`<div class="axis-header column-header"><span>列 ${col + 1}</span><button class="axis-delete" data-delete-col="${col}" aria-label="删除第 ${col + 1} 列" title="删除第 ${col + 1} 列" ${matrix.cols === 1 ? 'disabled' : ''}><i data-lucide="x"></i></button></div>`);
  }
  for (let row = 0; row < matrix.rows; row += 1) {
    cells.push(`<div class="axis-header row-header"><span>${row + 1}</span><button class="axis-delete" data-delete-row="${row}" aria-label="删除第 ${row + 1} 行" title="删除第 ${row + 1} 行" ${matrix.rows === 1 ? 'disabled' : ''}><i data-lucide="x"></i></button></div>`);
    for (let col = 0; col < matrix.cols; col += 1) {
      const cell = matrix.cells[cellKey(row, col)];
      const matrixColor = cell?.type === 'matrix' && validCellColor(state.matrices[cell.matrixId]?.appearance?.color);
      const classes = cell ? `cell-type-${cell.type}${cell.type === 'file' && isImageFile(cell.value) ? ' has-thumbnail' : ''}${validCellColor(cell.appearance?.color) ? ' has-custom-color' : ''}${matrixColor ? ' has-matrix-color' : ''}` : 'empty';
      const label = cell ? `${cell.title || '未命名单元格'}，双击打开` : '空单元格，点击添加数据';
      cells.push(`<article class="matrix-cell ${classes}" data-row="${row}" data-col="${col}" aria-label="${escapeHtml(label)}" tabindex="0" style="animation-delay:${Math.min((row * matrix.cols + col) * 16, 180)}ms">${cellMarkup(cell)}</article>`);
    }
  }
  elements.grid.innerHTML = cells.join('');
  applyCellAppearances();
  hydrateThumbnails();
  hydrateAppIcons();
  scheduleMinimapDraw();
}

function themeColor(variable) {
  return getComputedStyle(document.body).getPropertyValue(variable).trim();
}

function hexToHsl(color) {
  if (!validCellColor(color)) return { h: 160, s: 45, l: 34 };
  const red = parseInt(color.slice(1, 3), 16) / 255;
  const green = parseInt(color.slice(3, 5), 16) / 255;
  const blue = parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return { h: hue, s: saturation * 100, l: lightness * 100 };
}

function cascadeCellColor(row, col, cols = activeMatrix().cols) {
  const base = hexToHsl(state.settings.accent);
  const index = row * Math.max(1, cols) + col;
  const hue = (base.h + index * 13 + row * 7) % 360;
  const saturation = Math.max(42, Math.min(72, base.s + ((index % 3) - 1) * 5));
  const baseLightness = state.settings.mode === 'dark' ? 64 : 43;
  const lightness = baseLightness + ((row + col) % 3) * 3;
  return `hsl(${Math.round(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

function typeCellColor(cell) {
  const variables = {
    file: '--file',
    link: '--link',
    text: '--data',
    matrix: '--matrix',
    table: '--table',
    markdown: '--markdown'
  };
  return themeColor(variables[cell?.type] || '--accent');
}

function cellDisplayColor(cell, row, col, cols = activeMatrix().cols) {
  if (!cell) return themeColor('--line-strong');
  if (validCellColor(cell.appearance?.color)) return cell.appearance.color;
  if (cell.type === 'matrix') {
    const matrixColor = state.matrices[cell.matrixId]?.appearance?.color;
    if (validCellColor(matrixColor)) return matrixColor;
  }
  if (state.settings.cellColorMode === 'cascade') return cascadeCellColor(row, col, cols);
  if (state.settings.cellColorMode === 'accent') return themeColor('--accent');
  return typeCellColor(cell);
}

function minimapCellColor(cell, row, col) {
  return cellDisplayColor(cell, row, col);
}

function drawMinimap() {
  minimapFrame = null;
  if (!state || !elements.minimapCanvas.isConnected) return;
  const displayWidth = elements.minimapCanvas.clientWidth;
  const displayHeight = elements.minimapCanvas.clientHeight;
  if (!displayWidth || !displayHeight) return;
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(displayWidth * ratio);
  const pixelHeight = Math.round(displayHeight * ratio);
  if (elements.minimapCanvas.width !== pixelWidth || elements.minimapCanvas.height !== pixelHeight) {
    elements.minimapCanvas.width = pixelWidth;
    elements.minimapCanvas.height = pixelHeight;
  }

  const context = elements.minimapCanvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, displayWidth, displayHeight);
  context.fillStyle = themeColor('--bg');
  context.fillRect(0, 0, displayWidth, displayHeight);

  const worldWidth = Math.max(elements.canvas.scrollWidth, elements.canvas.clientWidth);
  const worldHeight = Math.max(elements.canvas.scrollHeight, elements.canvas.clientHeight);
  const padding = 5;
  const scale = Math.min((displayWidth - padding * 2) / worldWidth, (displayHeight - padding * 2) / worldHeight);
  const offsetX = (displayWidth - worldWidth * scale) / 2;
  const offsetY = (displayHeight - worldHeight * scale) / 2;
  const canvasRect = elements.canvas.getBoundingClientRect();
  const matrix = activeMatrix();

  elements.grid.querySelectorAll('.matrix-cell').forEach((cellElement) => {
    const row = Number(cellElement.dataset.row);
    const col = Number(cellElement.dataset.col);
    const cell = matrix.cells[cellKey(row, col)];
    const rect = cellElement.getBoundingClientRect();
    const worldX = rect.left - canvasRect.left + elements.canvas.scrollLeft;
    const worldY = rect.top - canvasRect.top + elements.canvas.scrollTop;
    const x = offsetX + worldX * scale;
    const y = offsetY + worldY * scale;
    const width = Math.max(2, rect.width * scale);
    const height = Math.max(2, rect.height * scale);
    context.globalAlpha = cell ? .9 : .22;
    context.fillStyle = minimapCellColor(cell, row, col);
    context.beginPath();
    context.roundRect(x, y, width, height, Math.min(2, width / 5));
    context.fill();
  });

  const viewportX = offsetX + elements.canvas.scrollLeft * scale;
  const viewportY = offsetY + elements.canvas.scrollTop * scale;
  const viewportWidth = Math.min(elements.canvas.clientWidth, worldWidth) * scale;
  const viewportHeight = Math.min(elements.canvas.clientHeight, worldHeight) * scale;
  context.globalAlpha = .12;
  context.fillStyle = themeColor('--accent');
  context.fillRect(viewportX, viewportY, viewportWidth, viewportHeight);
  context.globalAlpha = 1;
  context.strokeStyle = themeColor('--accent');
  context.lineWidth = 1.5;
  context.strokeRect(viewportX + .75, viewportY + .75, Math.max(0, viewportWidth - 1.5), Math.max(0, viewportHeight - 1.5));

  minimapMetrics = { scale, offsetX, offsetY, worldWidth, worldHeight };
}

function scheduleMinimapDraw() {
  if (!state || minimapFrame) return;
  minimapFrame = requestAnimationFrame(drawMinimap);
}

function applyMinimapVisibility() {
  const visible = state.settings.minimapVisible !== false;
  elements.minimap.hidden = !visible;
  elements.minimap.setAttribute('aria-hidden', String(!visible));
  document.body.classList.toggle('minimap-visible', visible);
  if (visible) scheduleMinimapDraw();
}

function navigateFromMinimap(event) {
  if (!minimapMetrics?.scale) return;
  const rect = elements.minimapCanvas.getBoundingClientRect();
  const worldX = (event.clientX - rect.left - minimapMetrics.offsetX) / minimapMetrics.scale;
  const worldY = (event.clientY - rect.top - minimapMetrics.offsetY) / minimapMetrics.scale;
  const maxLeft = Math.max(0, elements.canvas.scrollWidth - elements.canvas.clientWidth);
  const maxTop = Math.max(0, elements.canvas.scrollHeight - elements.canvas.clientHeight);
  elements.canvas.scrollLeft = Math.max(0, Math.min(maxLeft, worldX - elements.canvas.clientWidth / 2));
  elements.canvas.scrollTop = Math.max(0, Math.min(maxTop, worldY - elements.canvas.clientHeight / 2));
}

function applyCellAppearances() {
  const matrix = activeMatrix();
  elements.grid.querySelectorAll('.matrix-cell').forEach((cellElement) => {
    const row = Number(cellElement.dataset.row);
    const col = Number(cellElement.dataset.col);
    const cell = matrix.cells[cellKey(row, col)];
    if (validCellColor(cell?.appearance?.color)) cellElement.style.setProperty('--cell-color', cell.appearance.color);
    if (cell?.type === 'matrix') {
      const nestedColor = state.matrices[cell.matrixId]?.appearance?.color;
      if (validCellColor(nestedColor)) cellElement.style.setProperty('--matrix-color', nestedColor);
    }
    if (cell) cellElement.style.setProperty('--cascade-color', cascadeCellColor(row, col, matrix.cols));
  });
}

function swapCells(sourceRow, sourceCol, targetRow, targetCol) {
  if (sourceRow === targetRow && sourceCol === targetCol) return false;
  const matrix = activeMatrix();
  const sourceKey = cellKey(sourceRow, sourceCol);
  const targetKey = cellKey(targetRow, targetCol);
  const sourceCell = matrix.cells[sourceKey];
  const targetCell = matrix.cells[targetKey];
  if (!sourceCell && !targetCell) return false;

  if (targetCell) matrix.cells[sourceKey] = targetCell;
  else delete matrix.cells[sourceKey];
  if (sourceCell) matrix.cells[targetKey] = sourceCell;
  else delete matrix.cells[targetKey];
  touch(matrix);
  render();
  return true;
}

function createSwapGhost(cell) {
  const ghost = document.createElement('div');
  ghost.className = 'swap-ghost';
  if (validCellColor(cell?.appearance?.color)) {
    ghost.classList.add('has-color');
    ghost.style.setProperty('--swap-color', cell.appearance.color);
  }
  const symbol = cell?.appearance?.emoji ? `<span>${escapeHtml(cell.appearance.emoji)}</span>` : '<i data-lucide="repeat-2"></i>';
  ghost.innerHTML = `${symbol}<strong>${escapeHtml(cell?.title || '空单元格')}</strong>`;
  document.body.append(ghost);
  refreshIcons();
  return ghost;
}

function updateSwapTarget(event) {
  const canvas = $('#canvas');
  const scrollDeltaX = canvas.scrollLeft - swapDrag.startScrollLeft;
  const scrollDeltaY = canvas.scrollTop - swapDrag.startScrollTop;
  const targetLayout = swapDrag.cellLayouts.find(({ element, rect }) => {
    const left = rect.left - scrollDeltaX;
    const top = rect.top - scrollDeltaY;
    return element !== swapDrag.sourceElement
      && event.clientX >= left
      && event.clientX <= left + rect.width
      && event.clientY >= top
      && event.clientY <= top + rect.height;
  });
  const target = targetLayout?.element || null;
  if (target !== swapDrag.targetElement) {
    swapDrag.targetElement?.classList.remove('swap-target');
    swapDrag.targetElement?.style.removeProperty('--swap-shift-x');
    swapDrag.targetElement?.style.removeProperty('--swap-shift-y');
    swapDrag.targetElement = target;
    if (target) {
      const sourceRect = swapDrag.cellLayouts.find(({ element }) => element === swapDrag.sourceElement).rect;
      target.style.setProperty('--swap-shift-x', `${sourceRect.left - targetLayout.rect.left}px`);
      target.style.setProperty('--swap-shift-y', `${sourceRect.top - targetLayout.rect.top}px`);
      target.classList.add('swap-target');
    }
  }
  if (target) {
    const targetRect = targetLayout.rect;
    swapDrag.marker.hidden = false;
    swapDrag.marker.style.left = `${targetRect.left - scrollDeltaX}px`;
    swapDrag.marker.style.top = `${targetRect.top - scrollDeltaY}px`;
    swapDrag.marker.style.width = `${targetRect.width}px`;
    swapDrag.marker.style.height = `${targetRect.height}px`;
  } else {
    swapDrag.marker.hidden = true;
  }
}

function autoScrollSwap(event) {
  const canvas = $('#canvas');
  const rect = canvas.getBoundingClientRect();
  const edge = 54;
  let horizontal = 0;
  let vertical = 0;
  if (event.clientX < rect.left + edge) horizontal = -14;
  else if (event.clientX > rect.right - edge) horizontal = 14;
  if (event.clientY < rect.top + edge) vertical = -14;
  else if (event.clientY > rect.bottom - edge) vertical = 14;
  if (horizontal || vertical) canvas.scrollBy(horizontal, vertical);
}

function handleSwapPointerMove(event) {
  if (!swapDrag || event.pointerId !== swapDrag.pointerId) return;
  const distance = Math.hypot(event.clientX - swapDrag.startX, event.clientY - swapDrag.startY);
  if (!swapDrag.dragging && distance >= 6) {
    swapDrag.dragging = true;
    swapDrag.sourceElement.classList.add('swap-source');
    document.body.classList.add('is-swapping');
    const sourceCell = activeMatrix().cells[cellKey(swapDrag.sourceRow, swapDrag.sourceCol)];
    swapDrag.ghost = createSwapGhost(sourceCell);
    swapDrag.marker = document.createElement('div');
    swapDrag.marker.className = 'swap-drop-marker';
    swapDrag.marker.hidden = true;
    document.body.append(swapDrag.marker);
  }
  if (!swapDrag.dragging) return;
  event.preventDefault();
  const ghostX = Math.min(event.clientX + 15, window.innerWidth - 190);
  const ghostY = Math.min(event.clientY + 13, window.innerHeight - 58);
  swapDrag.ghost.style.transform = `translate(${Math.max(8, ghostX)}px, ${Math.max(48, ghostY)}px)`;
  autoScrollSwap(event);
  updateSwapTarget(event);
}

function finishSwapDrag(event, cancelled = false) {
  if (!swapDrag || event.pointerId !== swapDrag.pointerId) return;
  const current = swapDrag;
  try { current.sourceElement.releasePointerCapture(current.pointerId); } catch {}
  current.sourceElement.classList.remove('swap-source');
  current.targetElement?.classList.remove('swap-target');
  current.targetElement?.style.removeProperty('--swap-shift-x');
  current.targetElement?.style.removeProperty('--swap-shift-y');
  current.ghost?.remove();
  current.marker?.remove();
  document.body.classList.remove('is-swapping');
  swapDrag = null;

  if (cancelled || !current.dragging || !current.targetElement) return;
  const targetRow = Number(current.targetElement.dataset.row);
  const targetCol = Number(current.targetElement.dataset.col);
  if (swapCells(current.sourceRow, current.sourceCol, targetRow, targetCol)) toast('单元格已交换');
}

function deleteRow(row) {
  const matrix = activeMatrix();
  if (matrix.rows === 1) return toast('矩阵至少需要保留一行', true);
  const removed = Object.entries(matrix.cells).filter(([key]) => Number(key.split(':')[0]) === row);
  if (removed.length && !confirm(`第 ${row + 1} 行包含 ${removed.length} 个数据项，确认删除？`)) return;
  removeFavorites(removed.map(([, cell]) => cell));

  const nextCells = {};
  Object.entries(matrix.cells).forEach(([key, cell]) => {
    const [cellRow, cellCol] = key.split(':').map(Number);
    if (cellRow === row) {
      detachNested(cell);
      return;
    }
    nextCells[cellKey(cellRow > row ? cellRow - 1 : cellRow, cellCol)] = cell;
  });
  matrix.cells = nextCells;
  matrix.rows -= 1;
  touch(matrix);
  render();
}

function deleteColumn(col) {
  const matrix = activeMatrix();
  if (matrix.cols === 1) return toast('矩阵至少需要保留一列', true);
  const removed = Object.entries(matrix.cells).filter(([key]) => Number(key.split(':')[1]) === col);
  if (removed.length && !confirm(`第 ${col + 1} 列包含 ${removed.length} 个数据项，确认删除？`)) return;
  removeFavorites(removed.map(([, cell]) => cell));

  const nextCells = {};
  Object.entries(matrix.cells).forEach(([key, cell]) => {
    const [cellRow, cellCol] = key.split(':').map(Number);
    if (cellCol === col) {
      detachNested(cell);
      return;
    }
    nextCells[cellKey(cellRow, cellCol > col ? cellCol - 1 : cellCol)] = cell;
  });
  matrix.cells = nextCells;
  matrix.cols -= 1;
  touch(matrix);
  render();
}

function hydrateThumbnails() {
  elements.grid.querySelectorAll('[data-thumbnail]').forEach(async (image) => {
    const filePath = decodeURIComponent(image.dataset.thumbnail);
    if (!thumbnailCache.has(filePath)) {
      thumbnailCache.set(filePath, window.matrixAPI.getThumbnail(filePath).catch(() => null));
    }
    const dataUrl = await thumbnailCache.get(filePath);
    if (!dataUrl || !image.isConnected || decodeURIComponent(image.dataset.thumbnail) !== filePath) return;
    image.addEventListener('load', () => image.classList.add('loaded'), { once: true });
    image.src = dataUrl;
  });
}

function hydrateAppIcons() {
  elements.grid.querySelectorAll('[data-app-icon]').forEach(async (image) => {
    const filePath = decodeURIComponent(image.dataset.appIcon);
    if (!appIconCache.has(filePath)) {
      appIconCache.set(filePath, window.matrixAPI.getFileIcon(filePath).catch(() => null));
    }
    const dataUrl = await appIconCache.get(filePath);
    if (!dataUrl || !image.isConnected || decodeURIComponent(image.dataset.appIcon) !== filePath) return;
    image.addEventListener('load', () => image.closest('.cell-icon')?.classList.add('has-system-icon'), { once: true });
    image.src = dataUrl;
  });
}

function revealMatrixInTree(matrixId) {
  const ancestors = new Set(pathToMatrix(matrixId).slice(0, -1).map((matrix) => matrix.id));
  const next = state.settings.collapsedMatrices.filter((id) => !ancestors.has(id));
  const changed = next.length !== state.settings.collapsedMatrices.length;
  state.settings.collapsedMatrices = next;
  return changed;
}

function navigate(matrixId) {
  if (!state.matrices[matrixId]) return;
  state.activeMatrixId = matrixId;
  revealMatrixInTree(matrixId);
  scheduleSave();
  render();
  $('#canvas').scrollTo({ top: 0, left: 0, behavior: 'smooth' });
}

function positionPopover(popover, anchor) {
  popover.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const left = Math.min(rect.left, window.innerWidth - width - 12);
  const below = rect.bottom + 7;
  const top = below + height < window.innerHeight ? below : Math.max(50, rect.top - height - 7);
  popover.style.left = `${Math.max(12, left)}px`;
  popover.style.top = `${top}px`;
}

function positionPopoverAt(popover, clientX, clientY) {
  popover.hidden = false;
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  popover.style.left = `${Math.max(12, Math.min(clientX, window.innerWidth - width - 12))}px`;
  popover.style.top = `${Math.max(50, Math.min(clientY, window.innerHeight - height - 12))}px`;
}

function hidePopovers(except = null) {
  [elements.addPopover, elements.cellMenu, elements.matrixMenu, elements.matrixContextMenu].forEach((popover) => {
    if (popover !== except) popover.hidden = true;
  });
}

function openAddMenu(cellElement) {
  targetCell = { row: Number(cellElement.dataset.row), col: Number(cellElement.dataset.col) };
  hidePopovers(elements.addPopover);
  positionPopover(elements.addPopover, cellElement);
}

function toast(message, isError = false) {
  const item = document.createElement('div');
  item.className = `toast${isError ? ' error' : ''}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  setTimeout(() => item.remove(), 3200);
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function openEditor(type, row, col, existing = null) {
  editorContext = { type, row, col, existing };
  const labels = {
    text: ['自定义数据', existing ? '编辑数据' : '添加数据'],
    link: ['嵌入网页', existing ? '编辑网页' : '添加网页'],
    file: ['文件或应用', '编辑文件'],
    matrix: ['嵌套矩阵', '编辑矩阵']
  };
  elements.editorEyebrow.textContent = labels[type][0];
  elements.editorTitle.textContent = labels[type][1];
  elements.titleInput.value = existing?.title || '';
  elements.valueInput.value = existing?.value || '';
  elements.valueField.hidden = type === 'matrix';
  elements.valueInput.readOnly = type === 'file';
  elements.valueLabel.textContent = type === 'link' ? '网页地址' : type === 'file' ? '文件路径' : '内容';
  elements.editorHint.textContent = type === 'link' ? '保存时将自动获取网页标题，手动填写的标题会优先保留。' : type === 'file' ? '文件路径由系统提供，如需更换请重新选择文件。' : type === 'matrix' ? '名称会同步到矩阵树和当前单元格。' : '支持多行文字、数值、日期或任意备注。';
  elements.saveCellBtn.disabled = false;
  elements.saveCellBtn.textContent = '保存';
  elements.editor.showModal();
  setTimeout(() => (type === 'file' ? elements.titleInput : (existing?.title ? elements.titleInput : elements.valueInput)).focus(), 0);
}

function renderMarkdown(source) {
  const parsed = window.marked.parse(source || '', { gfm: true, breaks: true, async: false });
  return window.DOMPurify.sanitize(parsed, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['style']
  });
}

function markdownPlainText(source) {
  const container = document.createElement('div');
  container.innerHTML = renderMarkdown(source);
  return container.textContent.replace(/\s+/g, ' ').trim();
}

function updateMarkdownPreview() {
  const source = elements.markdownInput.value;
  elements.markdownPreview.innerHTML = source.trim() ? renderMarkdown(source) : '<p class="markdown-empty">暂无内容</p>';
  const lines = source ? source.split(/\r?\n/).length : 0;
  elements.markdownStats.textContent = `${source.length} 字符 · ${lines} 行`;
}

function openMarkdownEditor(row, col, existing = null) {
  markdownContext = { row, col, cellId: existing?.id || uid(), appearance: existing?.appearance ? structuredClone(existing.appearance) : null };
  elements.markdownTitleInput.value = existing?.title || '未命名 Markdown';
  elements.markdownInput.value = existing?.value || '';
  updateMarkdownPreview();
  elements.markdownDialog.showModal();
  setTimeout(() => elements.markdownInput.focus(), 0);
}

function defaultTableValue(type) {
  return type === 'boolean' ? false : '';
}

function coerceTableValue(value, type) {
  if (type === 'boolean') return value === true || value === 'true' || value === 1;
  if (type === 'number') {
    if (value === '' || value === null || value === undefined) return '';
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : '';
  }
  return value === null || value === undefined ? '' : String(value);
}

function createTableDraft(existing) {
  if (existing?.value?.columns?.length) {
    const draft = structuredClone(existing.value);
    draft.columns = draft.columns.map((column, index) => ({
      id: column.id || uid(),
      name: column.name || `字段 ${index + 1}`,
      type: TABLE_TYPES[column.type] ? column.type : 'text'
    }));
    draft.rows = (draft.rows || []).map((row) => ({ id: row.id || uid(), values: row.values || {} }));
    return draft;
  }

  const columns = [
    { id: uid(), name: '名称', type: 'text' },
    { id: uid(), name: '数量', type: 'number' },
    { id: uid(), name: '日期', type: 'date' }
  ];
  return {
    columns,
    rows: [{ id: uid(), values: Object.fromEntries(columns.map((column) => [column.id, defaultTableValue(column.type)])) }]
  };
}

function tableValueInput(row, column, rowIndex) {
  const rawValue = row.values[column.id] ?? defaultTableValue(column.type);
  const attributes = `data-table-value data-row-index="${rowIndex}" data-column-id="${column.id}"`;
  if (column.type === 'boolean') {
    return `<input class="table-boolean-input" type="checkbox" ${attributes} ${rawValue === true ? 'checked' : ''} aria-label="${escapeHtml(column.name)}">`;
  }
  const step = column.type === 'number' ? ' step="any"' : '';
  return `<input class="table-value-input" type="${TABLE_TYPES[column.type].input}" ${attributes}${step} value="${escapeHtml(rawValue)}" aria-label="${escapeHtml(column.name)}">`;
}

function renderTableEditor() {
  const typeOptions = Object.entries(TABLE_TYPES).map(([value, type]) => `<option value="${value}">${type.label}</option>`).join('');
  const headers = tableDraft.columns.map((column, index) => `
    <th>
      <div class="column-name-line">
        <input data-column-name="${column.id}" value="${escapeHtml(column.name)}" maxlength="40" required aria-label="第 ${index + 1} 列名称">
        <button class="icon-button" type="button" data-remove-column="${column.id}" aria-label="删除列 ${escapeHtml(column.name)}" title="删除此列" ${tableDraft.columns.length === 1 ? 'disabled' : ''}><i data-lucide="trash-2"></i></button>
      </div>
      <select class="column-type-select" data-column-type="${column.id}" aria-label="${escapeHtml(column.name)}的数据类型">${typeOptions}</select>
    </th>`).join('');

  const rows = tableDraft.rows.length ? tableDraft.rows.map((row, rowIndex) => `
    <tr>
      <td class="table-index">${rowIndex + 1}</td>
      ${tableDraft.columns.map((column) => `<td class="${column.type === 'boolean' ? 'table-boolean-cell' : ''}">${tableValueInput(row, column, rowIndex)}</td>`).join('')}
      <td class="table-row-action"><button class="icon-button remove-table-row" type="button" data-remove-table-row="${rowIndex}" aria-label="删除第 ${rowIndex + 1} 行" title="删除此行"><i data-lucide="trash-2"></i></button></td>
    </tr>`).join('') : `<tr class="empty-table-row"><td class="table-index">—</td><td colspan="${tableDraft.columns.length + 1}">暂无数据行</td></tr>`;

  elements.tableGrid.innerHTML = `<table class="data-table-editor"><thead><tr><th class="table-index">#</th>${headers}<th class="table-row-action"></th></tr></thead><tbody>${rows}</tbody></table>`;
  tableDraft.columns.forEach((column) => {
    const select = elements.tableGrid.querySelector(`[data-column-type="${column.id}"]`);
    if (select) select.value = column.type;
  });
  elements.tableSummary.textContent = `${tableDraft.columns.length} 列 · ${tableDraft.rows.length} 行`;
  refreshIcons();
}

function openTableEditor(row, col, existing = null) {
  tableContext = { row, col, cellId: existing?.id || uid(), appearance: existing?.appearance ? structuredClone(existing.appearance) : null };
  tableDraft = createTableDraft(existing);
  elements.tableTitleInput.value = existing?.title || '未命名数据表';
  renderTableEditor();
  elements.tableDialog.showModal();
  setTimeout(() => elements.tableTitleInput.focus(), 0);
}

async function saveEditor() {
  const { type, row, col, existing } = editorContext;
  const matrix = activeMatrix();
  const key = cellKey(row, col);
  const title = elements.titleInput.value.trim();
  const value = elements.valueInput.value.trim();

  if (type === 'link') {
    const url = normalizeUrl(value);
    if (!url) return toast('请输入网页地址', true);
    try { new URL(url); } catch { return toast('网页地址格式不正确', true); }
    elements.saveCellBtn.disabled = true;
    elements.saveCellBtn.textContent = '读取标题…';
    let resolvedTitle = title;
    if (!resolvedTitle) {
      try {
        resolvedTitle = await window.matrixAPI.fetchTitle(url);
      } catch (error) {
        resolvedTitle = new URL(url).hostname;
        toast('未能读取网页标题，已使用域名代替', true);
      }
    }
    matrix.cells[key] = { id: existing?.id || uid(), ...existing, type: 'link', title: resolvedTitle, value: url };
  } else if (type === 'text') {
    if (!title && !value) return toast('请填写标题或内容', true);
    matrix.cells[key] = { id: existing?.id || uid(), ...existing, type: 'text', title: title || '自定义数据', value };
  } else if (type === 'file') {
    matrix.cells[key] = { ...existing, title: title || fileName(existing.value) };
  } else if (type === 'matrix') {
    const nested = state.matrices[existing.matrixId];
    if (!nested) return toast('这个嵌套矩阵已不存在', true);
    nested.title = title || '未命名矩阵';
    nested.updatedAt = Date.now();
    matrix.cells[key] = { ...existing, title: nested.title };
  }

  touch(matrix);
  elements.editor.close();
  render();
}

function addNestedMatrix(row, col) {
  const parent = activeMatrix();
  const nested = createMatrix('未命名矩阵', parent.id, 3, 3);
  state.matrices[nested.id] = nested;
  parent.cells[cellKey(row, col)] = { id: uid(), type: 'matrix', title: nested.title, matrixId: nested.id };
  touch(parent);
  render();
  toast('嵌套矩阵已创建，双击单元格进入');
}

function matrixCellReferences(matrixId) {
  const references = [];
  Object.values(state.matrices).forEach((matrix) => {
    Object.entries(matrix.cells).forEach(([key, cell]) => {
      if (cell?.type === 'matrix' && cell.matrixId === matrixId) references.push({ matrix, key, cell });
    });
  });
  return references;
}

function attachMatrixToCell(matrixId, row, col) {
  const nested = state.matrices[matrixId];
  const parent = activeMatrix();
  if (!nested) return false;
  if (parent.cells[cellKey(row, col)]) {
    toast('请将矩阵放到空单元格', true);
    return false;
  }
  if (matrixId === parent.id || pathToMatrix(parent.id).some((matrix) => matrix.id === matrixId)) {
    toast('不能将矩阵嵌入自身或其子矩阵', true);
    return false;
  }

  const references = matrixCellReferences(matrixId);
  const reference = references[0]?.cell;
  references.forEach(({ matrix, key }) => {
    delete matrix.cells[key];
    matrix.updatedAt = Date.now();
  });
  removeFavorites(references.slice(1).map((item) => item.cell));

  nested.parentId = parent.id;
  nested.updatedAt = Date.now();
  parent.cells[cellKey(row, col)] = {
    ...reference,
    id: reference?.id || uid(),
    type: 'matrix',
    title: nested.title,
    matrixId: nested.id
  };
  state.settings.collapsedMatrices = state.settings.collapsedMatrices.filter((id) => id !== parent.id);
  touch(parent);
  render();
  toast(`“${nested.title}”已嵌入当前矩阵`);
  return true;
}

function assignFiles(paths, startRow, startCol) {
  if (!paths.length) return;
  const matrix = activeMatrix();
  let index = startRow * matrix.cols + startCol;
  paths.forEach((filePath) => {
    while (matrix.cells[cellKey(Math.floor(index / matrix.cols), index % matrix.cols)]) index += 1;
    const row = Math.floor(index / matrix.cols);
    const col = index % matrix.cols;
    if (row >= matrix.rows) matrix.rows = row + 1;
    matrix.cells[cellKey(row, col)] = { id: uid(), type: 'file', title: fileName(filePath), value: filePath };
    index += 1;
  });
  touch(matrix);
  render();
  toast(paths.length === 1 ? '文件已加入矩阵' : `已加入 ${paths.length} 个文件`);
}

async function handleCellAction(cell) {
  if (!cell) return;
  if (cell.type === 'file') {
    const error = await window.matrixAPI.openFile(cell.value);
    if (error) toast(`无法打开文件：${error}`, true);
  } else if (cell.type === 'link') {
    await window.matrixAPI.openLink(cell.value);
  } else if (cell.type === 'matrix') {
    if (state.matrices[cell.matrixId]) navigate(cell.matrixId);
    else toast('这个嵌套矩阵已不存在', true);
  } else if (cell.type === 'table') {
    openTableEditor(targetCell.row, targetCell.col, cell);
  } else if (cell.type === 'markdown') {
    openMarkdownEditor(targetCell.row, targetCell.col, cell);
  } else {
    const selected = document.querySelector(`.matrix-cell[data-row="${targetCell?.row}"][data-col="${targetCell?.col}"]`);
    if (selected) selected.querySelector('[data-cell-menu]')?.click();
  }
}

function detachNested(cell) {
  if (cell?.type === 'matrix' && state.matrices[cell.matrixId]) state.matrices[cell.matrixId].parentId = null;
}

function removeMatrix(matrixId) {
  const matrix = state.matrices[matrixId];
  if (!matrix) return;
  const descendants = new Set([matrixId]);
  let changed = true;
  while (changed) {
    changed = false;
    Object.values(state.matrices).forEach((candidate) => {
      if (candidate.parentId && descendants.has(candidate.parentId) && !descendants.has(candidate.id)) {
        descendants.add(candidate.id);
        changed = true;
      }
    });
  }
  const removedCells = [];
  descendants.forEach((id) => removedCells.push(...Object.values(state.matrices[id]?.cells || {})));
  Object.values(state.matrices).forEach((candidate) => {
    Object.entries(candidate.cells).forEach(([key, cell]) => {
      if (cell?.type === 'matrix' && descendants.has(cell.matrixId)) {
        removedCells.push(cell);
        delete candidate.cells[key];
      }
    });
  });
  removeFavorites(removedCells);
  state.matrixFavorites = state.matrixFavorites.filter((id) => !descendants.has(id));
  state.settings.collapsedMatrices = state.settings.collapsedMatrices.filter((id) => !descendants.has(id));
  descendants.forEach((id) => delete state.matrices[id]);
}

function requestDeleteMatrix(matrixId) {
  const matrix = state.matrices[matrixId];
  if (!matrix) return false;
  const nextId = matrix.parentId && state.matrices[matrix.parentId]
    ? matrix.parentId
    : Object.keys(state.matrices).find((id) => id !== matrixId && !pathToMatrix(id).some((item) => item.id === matrixId));
  if (!nextId) {
    toast('至少需要保留一个矩阵', true);
    return false;
  }
  if (!confirm(`删除“${matrix.title}”及其所有嵌套矩阵？此操作无法撤销。`)) return false;
  const activeWillBeDeleted = pathToMatrix(state.activeMatrixId).some((item) => item.id === matrixId);
  removeMatrix(matrixId);
  if (activeWillBeDeleted || !state.matrices[state.activeMatrixId]) state.activeMatrixId = nextId;
  scheduleSave();
  render();
  return true;
}

function toggleMatrixCollapsed(matrixId) {
  const hasChildren = Object.values(state.matrices).some((matrix) => matrix.parentId === matrixId);
  if (!hasChildren) return false;
  const collapsed = new Set(state.settings.collapsedMatrices);
  if (collapsed.has(matrixId)) collapsed.delete(matrixId);
  else collapsed.add(matrixId);
  state.settings.collapsedMatrices = Array.from(collapsed);
  scheduleSave();
  renderTree();
  refreshIcons();
  return true;
}

function syncMatrixContextMenu(matrixId) {
  const matrix = state.matrices[matrixId];
  if (!matrix) return;
  const favoriteButton = $('#contextFavoriteMatrixAction');
  const favorite = isMatrixFavorite(matrixId);
  favoriteButton.classList.toggle('favorite-active', favorite);
  favoriteButton.querySelector('span').textContent = favorite ? '取消收藏矩阵' : '收藏矩阵';
  const toggleButton = $('#contextToggleMatrixAction');
  const hasChildren = Object.values(state.matrices).some((candidate) => candidate.parentId === matrixId);
  toggleButton.hidden = !hasChildren;
  toggleButton.querySelector('span').textContent = state.settings.collapsedMatrices.includes(matrixId) ? '展开子矩阵' : '折叠子矩阵';
}

function applyTheme() {
  const { mode, accent, cellColorMode } = state.settings;
  document.body.dataset.theme = mode;
  document.body.classList.toggle('colorful-cells', cellColorMode === 'type');
  document.body.classList.toggle('cascade-cells', cellColorMode === 'cascade');
  state.settings.colorful = cellColorMode === 'type';
  const root = document.documentElement;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-strong', `color-mix(in srgb, ${accent} 78%, #17201c)`);
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent} ${mode === 'dark' ? 25 : 16}%, var(--surface-raised))`);
  root.style.setProperty('--accent-faint', `color-mix(in srgb, ${accent} ${mode === 'dark' ? 13 : 7}%, var(--surface-raised))`);
  document.querySelectorAll('#modeControl button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  document.querySelectorAll('#accentSwatches button').forEach((button) => button.classList.toggle('active', button.dataset.color?.toLowerCase() === accent.toLowerCase()));
  document.querySelectorAll('#cellColorModeControl button').forEach((button) => button.classList.toggle('active', button.dataset.cellColorMode === cellColorMode));
  $('#customAccent').value = accent;
  document.querySelectorAll('.theme-preview span').forEach((item, index) => item.style.setProperty('--cascade-color', cascadeCellColor(0, index, 4)));
  if (elements.grid.childElementCount) applyCellAppearances();
  if (elements.favoritesList.childElementCount) {
    renderFavorites();
    refreshIcons();
  }
  applyMinimapVisibility();
  scheduleMinimapDraw();
}

function finishMatrixTreeDrag() {
  draggedMatrixId = null;
  document.body.classList.remove('matrix-tree-drag');
  document.querySelectorAll('.tree-drag-source, .matrix-drop-target, .matrix-drop-blocked, .drag-over').forEach((item) => {
    item.classList.remove('tree-drag-source', 'matrix-drop-target', 'matrix-drop-blocked', 'drag-over');
  });
}

elements.tree.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.tree-item[data-matrix-id]');
  if (!item || !state.matrices[item.dataset.matrixId]) return;
  draggedMatrixId = item.dataset.matrixId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-data-matrix-id', draggedMatrixId);
  item.classList.add('tree-drag-source');
  document.body.classList.add('matrix-tree-drag');
  hidePopovers();
});

elements.tree.addEventListener('dragend', finishMatrixTreeDrag);

elements.tree.addEventListener('contextmenu', (event) => {
  const row = event.target.closest('.tree-row[data-tree-matrix-id]');
  if (!row) return;
  event.preventDefault();
  finishMatrixTreeDrag();
  treeContextMatrixId = row.dataset.treeMatrixId;
  hidePopovers(elements.matrixContextMenu);
  syncMatrixContextMenu(treeContextMatrixId);
  positionPopoverAt(elements.matrixContextMenu, event.clientX, event.clientY);
  refreshIcons();
});

elements.tree.addEventListener('click', (event) => {
  const favoriteButton = event.target.closest('[data-matrix-favorite]');
  if (favoriteButton) {
    toggleMatrixFavorite(favoriteButton.dataset.matrixFavorite);
    return;
  }
  const toggle = event.target.closest('[data-tree-toggle]');
  if (toggle) {
    toggleMatrixCollapsed(toggle.dataset.treeToggle);
    return;
  }
  const button = event.target.closest('[data-matrix-id]');
  if (button) navigate(button.dataset.matrixId);
});

elements.matrixContextMenu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-matrix-context-action]')?.dataset.matrixContextAction;
  const matrixId = treeContextMatrixId;
  const matrix = state.matrices[matrixId];
  if (!action || !matrix) return;
  elements.matrixContextMenu.hidden = true;
  if (action === 'open') {
    navigate(matrixId);
  } else if (action === 'rename') {
    navigate(matrixId);
    requestAnimationFrame(() => {
      elements.title.focus();
      elements.title.select();
    });
  } else if (action === 'appearance') {
    openMatrixAppearanceEditor(matrixId);
  } else if (action === 'favorite') {
    toggleMatrixFavorite(matrixId);
  } else if (action === 'toggle') {
    toggleMatrixCollapsed(matrixId);
  } else if (action === 'delete') {
    requestDeleteMatrix(matrixId);
  }
});

elements.favoritesList.addEventListener('click', async (event) => {
  const matrixRemoveButton = event.target.closest('[data-matrix-favorite-remove]');
  if (matrixRemoveButton) {
    removeMatrixFavorite(matrixRemoveButton.dataset.matrixFavoriteRemove);
    scheduleSave();
    renderTree();
    renderFavorites();
    refreshIcons();
    toast('已取消收藏矩阵');
    return;
  }
  const removeButton = event.target.closest('[data-favorite-remove]');
  if (removeButton) {
    removeFavorite(removeButton.dataset.favoriteRemove);
    scheduleSave();
    renderFavorites();
    refreshIcons();
    toast('已取消收藏');
    return;
  }
  const item = event.target.closest('[data-favorite-id]');
  if (item) {
    await openFavorite(item.dataset.favoriteId);
    return;
  }
  const matrixItem = event.target.closest('[data-favorite-matrix-id]');
  if (matrixItem) navigate(matrixItem.dataset.favoriteMatrixId);
});

elements.breadcrumbs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-matrix-id]');
  if (button) navigate(button.dataset.matrixId);
});

elements.grid.addEventListener('click', (event) => {
  const deleteRowButton = event.target.closest('[data-delete-row]');
  if (deleteRowButton) {
    deleteRow(Number(deleteRowButton.dataset.deleteRow));
    return;
  }
  const deleteColButton = event.target.closest('[data-delete-col]');
  if (deleteColButton) {
    deleteColumn(Number(deleteColButton.dataset.deleteCol));
    return;
  }
  const cellElement = event.target.closest('.matrix-cell');
  if (!cellElement) return;
  const row = Number(cellElement.dataset.row);
  const col = Number(cellElement.dataset.col);
  const cell = activeMatrix().cells[cellKey(row, col)];
  targetCell = { row, col };
  if (!cell) openAddMenu(cellElement);
  else if (event.target.closest('[data-cell-menu]')) {
    hidePopovers(elements.cellMenu);
    syncFavoriteAction(cell);
    positionPopover(elements.cellMenu, event.target.closest('[data-cell-menu]'));
  }
});

elements.grid.addEventListener('dblclick', async (event) => {
  if (event.target.closest('[data-cell-menu]')) return;
  const cellElement = event.target.closest('.matrix-cell');
  if (!cellElement) return;
  const row = Number(cellElement.dataset.row);
  const col = Number(cellElement.dataset.col);
  targetCell = { row, col };
  await handleCellAction(activeMatrix().cells[cellKey(row, col)]);
});

elements.grid.addEventListener('keydown', async (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  const cellElement = event.target.closest('.matrix-cell');
  const row = Number(cellElement.dataset.row);
  const col = Number(cellElement.dataset.col);
  targetCell = { row, col };
  const cell = activeMatrix().cells[cellKey(row, col)];
  if (cell) await handleCellAction(cell);
  else openAddMenu(cellElement);
});

elements.grid.addEventListener('contextmenu', (event) => event.preventDefault());

elements.grid.addEventListener('pointerdown', (event) => {
  if (event.button !== 2) return;
  const cellElement = event.target.closest('.matrix-cell');
  if (!cellElement) return;
  event.preventDefault();
  hidePopovers();
  const canvas = $('#canvas');
  swapDrag = {
    pointerId: event.pointerId,
    sourceElement: cellElement,
    sourceRow: Number(cellElement.dataset.row),
    sourceCol: Number(cellElement.dataset.col),
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
    targetElement: null,
    ghost: null,
    marker: null,
    startScrollLeft: canvas.scrollLeft,
    startScrollTop: canvas.scrollTop,
    cellLayouts: Array.from(elements.grid.querySelectorAll('.matrix-cell')).map((element) => ({ element, rect: element.getBoundingClientRect() }))
  };
  try { cellElement.setPointerCapture(event.pointerId); } catch {}
});

document.addEventListener('pointermove', handleSwapPointerMove, { passive: false });
document.addEventListener('pointerup', finishSwapDrag);
document.addEventListener('pointercancel', (event) => finishSwapDrag(event, true));

elements.canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 1) return;
  event.preventDefault();
  hidePopovers();
  panDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startScrollLeft: elements.canvas.scrollLeft,
    startScrollTop: elements.canvas.scrollTop
  };
  document.body.classList.add('is-panning');
  try { elements.canvas.setPointerCapture(event.pointerId); } catch {}
});

elements.canvas.addEventListener('auxclick', (event) => {
  if (event.button === 1) event.preventDefault();
});

document.addEventListener('pointermove', (event) => {
  if (!panDrag || event.pointerId !== panDrag.pointerId) return;
  event.preventDefault();
  elements.canvas.scrollLeft = panDrag.startScrollLeft - (event.clientX - panDrag.startX);
  elements.canvas.scrollTop = panDrag.startScrollTop - (event.clientY - panDrag.startY);
}, { passive: false });

function finishPanDrag(event) {
  if (!panDrag || event.pointerId !== panDrag.pointerId) return;
  try { elements.canvas.releasePointerCapture(panDrag.pointerId); } catch {}
  panDrag = null;
  document.body.classList.remove('is-panning');
}

document.addEventListener('pointerup', finishPanDrag);
document.addEventListener('pointercancel', finishPanDrag);

elements.canvas.addEventListener('scroll', scheduleMinimapDraw, { passive: true });
window.addEventListener('resize', scheduleMinimapDraw);

elements.minimapCanvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  minimapDrag = { pointerId: event.pointerId };
  elements.minimapCanvas.classList.add('navigating');
  try { elements.minimapCanvas.setPointerCapture(event.pointerId); } catch {}
  navigateFromMinimap(event);
});

elements.minimapCanvas.addEventListener('pointermove', (event) => {
  if (!minimapDrag || event.pointerId !== minimapDrag.pointerId) return;
  event.preventDefault();
  navigateFromMinimap(event);
});

function finishMinimapDrag(event) {
  if (!minimapDrag || event.pointerId !== minimapDrag.pointerId) return;
  try { elements.minimapCanvas.releasePointerCapture(minimapDrag.pointerId); } catch {}
  minimapDrag = null;
  elements.minimapCanvas.classList.remove('navigating');
}

elements.minimapCanvas.addEventListener('pointerup', finishMinimapDrag);
elements.minimapCanvas.addEventListener('pointercancel', finishMinimapDrag);

['dragenter', 'dragover'].forEach((type) => elements.grid.addEventListener(type, (event) => {
  const cellElement = event.target.closest('.matrix-cell');
  if (!cellElement) return;
  event.preventDefault();
  if (draggedMatrixId) {
    event.dataTransfer.dropEffect = 'move';
    const row = Number(cellElement.dataset.row);
    const col = Number(cellElement.dataset.col);
    const occupied = Boolean(activeMatrix().cells[cellKey(row, col)]);
    document.querySelectorAll('.matrix-drop-target, .matrix-drop-blocked').forEach((item) => {
      if (item !== cellElement) item.classList.remove('matrix-drop-target', 'matrix-drop-blocked');
    });
    cellElement.classList.toggle('matrix-drop-target', !occupied);
    cellElement.classList.toggle('matrix-drop-blocked', occupied);
  } else {
    cellElement.classList.add('drag-over');
  }
}));

elements.grid.addEventListener('dragleave', (event) => {
  const cell = event.target.closest('.matrix-cell');
  if (cell && !cell.contains(event.relatedTarget)) cell.classList.remove('drag-over', 'matrix-drop-target', 'matrix-drop-blocked');
});

elements.grid.addEventListener('drop', (event) => {
  event.preventDefault();
  const cellElement = event.target.closest('.matrix-cell');
  const matrixId = draggedMatrixId || event.dataTransfer.getData('application/x-data-matrix-id');
  finishMatrixTreeDrag();
  if (!cellElement) return;
  const row = Number(cellElement.dataset.row);
  const col = Number(cellElement.dataset.col);
  if (matrixId) return attachMatrixToCell(matrixId, row, col);
  const paths = Array.from(event.dataTransfer.files).map((file) => window.matrixAPI.getFilePath(file)).filter(Boolean);
  if (paths.length) return assignFiles(paths, row, col);
  const droppedText = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
  if (/^https?:\/\//i.test(droppedText.trim())) {
    openEditor('link', row, col, { type: 'link', title: '', value: droppedText.trim() });
  } else if (droppedText.trim()) {
    openEditor('text', row, col, { type: 'text', title: '', value: droppedText.trim() });
  }
});

elements.addPopover.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action || !targetCell) return;
  elements.addPopover.hidden = true;
  if (action === 'file') {
    const paths = await window.matrixAPI.pickFiles();
    assignFiles(paths, targetCell.row, targetCell.col);
  } else if (action === 'matrix') {
    addNestedMatrix(targetCell.row, targetCell.col);
  } else if (action === 'table') {
    openTableEditor(targetCell.row, targetCell.col);
  } else if (action === 'markdown') {
    openMarkdownEditor(targetCell.row, targetCell.col);
  } else {
    openEditor(action, targetCell.row, targetCell.col);
  }
});

elements.cellMenu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action || !targetCell) return;
  const matrix = activeMatrix();
  const key = cellKey(targetCell.row, targetCell.col);
  const cell = matrix.cells[key];
  elements.cellMenu.hidden = true;
  if (action === 'clear') {
    removeFavorite(cell?.id);
    detachNested(cell);
    delete matrix.cells[key];
    touch(matrix);
    render();
  } else if (action === 'favorite') {
    toggleFavorite(cell);
  } else if (action === 'edit') {
    if (cell.type === 'table') openTableEditor(targetCell.row, targetCell.col, cell);
    else if (cell.type === 'markdown') openMarkdownEditor(targetCell.row, targetCell.col, cell);
    else openEditor(cell.type, targetCell.row, targetCell.col, cell);
  } else if (action === 'appearance') {
    openAppearanceEditor(targetCell.row, targetCell.col, cell);
  }
});

elements.editorForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveEditor();
});

elements.editorForm.querySelectorAll('[data-dialog-close]').forEach((button) => {
  button.addEventListener('click', () => elements.editor.close());
});

elements.tableGrid.addEventListener('input', (event) => {
  const columnName = event.target.dataset.columnName;
  if (columnName) {
    const column = tableDraft.columns.find((item) => item.id === columnName);
    if (column) column.name = event.target.value;
    return;
  }
  if (event.target.hasAttribute('data-table-value')) {
    const row = tableDraft.rows[Number(event.target.dataset.rowIndex)];
    if (!row) return;
    row.values[event.target.dataset.columnId] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  }
});

elements.tableGrid.addEventListener('change', (event) => {
  const columnId = event.target.dataset.columnType;
  if (!columnId) return;
  const column = tableDraft.columns.find((item) => item.id === columnId);
  if (!column || !TABLE_TYPES[event.target.value]) return;
  column.type = event.target.value;
  tableDraft.rows.forEach((row) => {
    row.values[columnId] = coerceTableValue(row.values[columnId], column.type);
  });
  renderTableEditor();
});

elements.tableGrid.addEventListener('click', (event) => {
  const removeColumn = event.target.closest('[data-remove-column]');
  if (removeColumn && tableDraft.columns.length > 1) {
    const columnId = removeColumn.dataset.removeColumn;
    tableDraft.columns = tableDraft.columns.filter((column) => column.id !== columnId);
    tableDraft.rows.forEach((row) => delete row.values[columnId]);
    renderTableEditor();
    return;
  }
  const removeRow = event.target.closest('[data-remove-table-row]');
  if (removeRow) {
    tableDraft.rows.splice(Number(removeRow.dataset.removeTableRow), 1);
    renderTableEditor();
  }
});

$('#addTableColumnBtn').addEventListener('click', () => {
  const column = { id: uid(), name: `字段 ${tableDraft.columns.length + 1}`, type: 'text' };
  tableDraft.columns.push(column);
  tableDraft.rows.forEach((row) => { row.values[column.id] = ''; });
  renderTableEditor();
  elements.tableGrid.scrollTo({ left: elements.tableGrid.scrollWidth, behavior: 'smooth' });
});

$('#addTableRowBtn').addEventListener('click', () => {
  tableDraft.rows.push({
    id: uid(),
    values: Object.fromEntries(tableDraft.columns.map((column) => [column.id, defaultTableValue(column.type)]))
  });
  renderTableEditor();
  elements.tableGrid.scrollTo({ top: elements.tableGrid.scrollHeight, behavior: 'smooth' });
});

elements.tableForm.querySelectorAll('[data-table-close]').forEach((button) => {
  button.addEventListener('click', () => elements.tableDialog.close());
});

elements.tableForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = elements.tableTitleInput.value.trim() || '未命名数据表';
  const names = tableDraft.columns.map((column) => column.name.trim());
  if (names.some((name) => !name)) return toast('数据表列名不能为空', true);
  if (new Set(names).size !== names.length) return toast('数据表列名不能重复', true);

  tableDraft.columns.forEach((column, index) => { column.name = names[index]; });
  tableDraft.rows.forEach((row) => {
    tableDraft.columns.forEach((column) => {
      row.values[column.id] = coerceTableValue(row.values[column.id], column.type);
    });
  });
  const matrix = activeMatrix();
  matrix.cells[cellKey(tableContext.row, tableContext.col)] = { id: tableContext.cellId, type: 'table', title, value: structuredClone(tableDraft), ...(tableContext.appearance ? { appearance: tableContext.appearance } : {}) };
  touch(matrix);
  elements.tableDialog.close();
  render();
});

elements.markdownInput.addEventListener('input', updateMarkdownPreview);

elements.markdownPreview.addEventListener('click', async (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault();
  const opened = await window.matrixAPI.openLink(link.href);
  if (!opened) toast('这个链接类型无法打开', true);
});

elements.markdownForm.querySelectorAll('[data-markdown-close]').forEach((button) => {
  button.addEventListener('click', () => elements.markdownDialog.close());
});

elements.markdownForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = elements.markdownTitleInput.value.trim() || '未命名 Markdown';
  const value = elements.markdownInput.value;
  const matrix = activeMatrix();
  matrix.cells[cellKey(markdownContext.row, markdownContext.col)] = { id: markdownContext.cellId, type: 'markdown', title, value, ...(markdownContext.appearance ? { appearance: markdownContext.appearance } : {}) };
  touch(matrix);
  elements.markdownDialog.close();
  render();
});

function updateAppearanceEditor() {
  const color = validCellColor(appearanceDraft.color) ? appearanceDraft.color : state.settings.accent;
  elements.appearancePreview.style.setProperty('--cell-color', color);
  elements.appearancePreviewIcon.textContent = appearanceDraft.emoji || '◇';
  document.querySelectorAll('#cellColorSwatches [data-cell-color]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.cellColor.toLowerCase() === (appearanceDraft.color || '').toLowerCase());
  });
  const presetColors = Array.from(document.querySelectorAll('#cellColorSwatches [data-cell-color]')).map((button) => button.dataset.cellColor.toLowerCase());
  const isCustom = validCellColor(appearanceDraft.color) && !presetColors.includes(appearanceDraft.color.toLowerCase());
  document.querySelector('.cell-custom-color').classList.toggle('selected', isCustom);
  if (validCellColor(appearanceDraft.color)) $('#customCellColor').value = appearanceDraft.color;
  document.querySelectorAll('#emojiGrid [data-cell-emoji]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.cellEmoji === (appearanceDraft.emoji || ''));
  });
}

function openAppearanceEditor(row, col, cell) {
  appearanceContext = { row, col };
  appearanceDraft = {
    color: validCellColor(cell.appearance?.color) ? cell.appearance.color : '',
    emoji: cell.appearance?.emoji || ''
  };
  elements.appearancePreviewTitle.textContent = cell.title || '未命名单元格';
  updateAppearanceEditor();
  elements.appearanceDialog.showModal();
}

$('#cellColorSwatches').addEventListener('click', (event) => {
  const button = event.target.closest('[data-cell-color]');
  if (!button) return;
  appearanceDraft.color = button.dataset.cellColor;
  updateAppearanceEditor();
});

$('#customCellColor').addEventListener('input', (event) => {
  appearanceDraft.color = event.target.value;
  updateAppearanceEditor();
});

$('#emojiGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-cell-emoji]');
  if (!button) return;
  appearanceDraft.emoji = button.dataset.cellEmoji;
  updateAppearanceEditor();
});

elements.appearanceForm.querySelectorAll('[data-appearance-close]').forEach((button) => {
  button.addEventListener('click', () => elements.appearanceDialog.close());
});

elements.appearanceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const matrix = activeMatrix();
  const cell = matrix.cells[cellKey(appearanceContext.row, appearanceContext.col)];
  if (!cell) return elements.appearanceDialog.close();
  if (appearanceDraft.color || appearanceDraft.emoji) cell.appearance = { ...appearanceDraft };
  else delete cell.appearance;
  touch(matrix);
  elements.appearanceDialog.close();
  render();
});

function updateMatrixAppearanceEditor() {
  const color = validCellColor(matrixAppearanceDraft.color) ? matrixAppearanceDraft.color : state.settings.accent;
  const matrix = state.matrices[matrixAppearanceContext];
  const icon = MATRIX_ICONS.has(matrixAppearanceDraft.icon) && matrixAppearanceDraft.icon
    ? matrixAppearanceDraft.icon
    : matrixIconName(matrix, Boolean(matrix?.parentId));
  elements.matrixAppearancePreview.style.setProperty('--cell-color', color);
  elements.matrixAppearancePreviewIcon.innerHTML = `<i data-lucide="${icon}"></i>`;
  document.querySelectorAll('#matrixColorSwatches [data-matrix-color]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.matrixColor.toLowerCase() === (matrixAppearanceDraft.color || '').toLowerCase());
  });
  const presetColors = Array.from(document.querySelectorAll('#matrixColorSwatches [data-matrix-color]')).map((button) => button.dataset.matrixColor.toLowerCase());
  const isCustom = validCellColor(matrixAppearanceDraft.color) && !presetColors.includes(matrixAppearanceDraft.color.toLowerCase());
  document.querySelector('.matrix-custom-color').classList.toggle('selected', isCustom);
  if (validCellColor(matrixAppearanceDraft.color)) $('#customMatrixColor').value = matrixAppearanceDraft.color;
  document.querySelectorAll('#matrixIconGrid [data-matrix-icon]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.matrixIcon === (matrixAppearanceDraft.icon || ''));
  });
  refreshIcons();
}

function openMatrixAppearanceEditor(matrixId) {
  const matrix = state.matrices[matrixId];
  if (!matrix) return;
  matrixAppearanceContext = matrixId;
  matrixAppearanceDraft = {
    color: validCellColor(matrix.appearance?.color) ? matrix.appearance.color : '',
    icon: MATRIX_ICONS.has(matrix.appearance?.icon) ? matrix.appearance.icon : ''
  };
  elements.matrixAppearancePreviewTitle.textContent = matrix.title;
  updateMatrixAppearanceEditor();
  elements.matrixAppearanceDialog.showModal();
}

$('#matrixColorSwatches').addEventListener('click', (event) => {
  const button = event.target.closest('[data-matrix-color]');
  if (!button) return;
  event.preventDefault();
  matrixAppearanceDraft.color = button.dataset.matrixColor;
  updateMatrixAppearanceEditor();
});

$('#customMatrixColor').addEventListener('input', (event) => {
  matrixAppearanceDraft.color = event.target.value;
  updateMatrixAppearanceEditor();
});

$('#matrixIconGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-matrix-icon]');
  if (!button) return;
  event.preventDefault();
  matrixAppearanceDraft.icon = button.dataset.matrixIcon;
  updateMatrixAppearanceEditor();
});

elements.matrixAppearanceForm.querySelectorAll('[data-matrix-appearance-close]').forEach((button) => {
  button.addEventListener('click', () => elements.matrixAppearanceDialog.close());
});

elements.matrixAppearanceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const matrix = state.matrices[matrixAppearanceContext];
  if (!matrix) return elements.matrixAppearanceDialog.close();
  const color = validCellColor(matrixAppearanceDraft.color) ? matrixAppearanceDraft.color : '';
  const icon = MATRIX_ICONS.has(matrixAppearanceDraft.icon) ? matrixAppearanceDraft.icon : '';
  if (color || icon) matrix.appearance = { ...(color ? { color } : {}), ...(icon ? { icon } : {}) };
  else delete matrix.appearance;
  touch(matrix);
  elements.matrixAppearanceDialog.close();
  render();
});

elements.title.addEventListener('input', () => {
  const matrix = activeMatrix();
  matrix.title = elements.title.value || '未命名矩阵';
  Object.values(state.matrices).forEach((candidate) => {
    Object.values(candidate.cells).forEach((cell) => {
      if (cell?.type === 'matrix' && cell.matrixId === matrix.id) cell.title = matrix.title;
    });
  });
  touch(matrix);
  renderTree();
  renderFavorites();
  renderBreadcrumbsOnly();
  refreshIcons();
});

elements.title.addEventListener('blur', () => {
  if (!elements.title.value.trim()) {
    activeMatrix().title = '未命名矩阵';
    renderHeader();
    refreshIcons();
  }
});

function renderBreadcrumbsOnly() {
  const matrix = activeMatrix();
  elements.breadcrumbs.innerHTML = pathToMatrix(matrix.id).map((item, index, list) => `<button class="breadcrumb" data-matrix-id="${item.id}">${escapeHtml(item.title)}</button>${index < list.length - 1 ? '<i data-lucide="chevron-right"></i>' : ''}`).join('');
}

$('#addRowBtn').addEventListener('click', () => {
  activeMatrix().rows += 1;
  touch();
  renderHeader();
  renderGrid();
  refreshIcons();
  $('#canvas').scrollTo({ top: $('#canvas').scrollHeight, behavior: 'smooth' });
});

$('#addColBtn').addEventListener('click', () => {
  activeMatrix().cols += 1;
  touch();
  renderHeader();
  renderGrid();
  refreshIcons();
  $('#canvas').scrollTo({ left: $('#canvas').scrollWidth, behavior: 'smooth' });
});

$('#newRootBtn').addEventListener('click', () => {
  const matrix = createMatrix(`新矩阵 ${Object.keys(state.matrices).length + 1}`);
  state.matrices[matrix.id] = matrix;
  state.activeMatrixId = matrix.id;
  scheduleSave();
  render();
  elements.title.select();
});

$('#moreBtn').addEventListener('click', (event) => {
  hidePopovers(elements.matrixMenu);
  syncMatrixFavoriteAction();
  positionPopover(elements.matrixMenu, event.currentTarget);
});

elements.matrixMenu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  elements.matrixMenu.hidden = true;
  const matrix = activeMatrix();
  if (action === 'rename') {
    elements.title.focus();
    elements.title.select();
  } else if (action === 'favorite') {
    toggleMatrixFavorite(matrix.id);
  } else if (action === 'clear') {
    if (!confirm(`清空“${matrix.title}”中的全部单元格？嵌套矩阵将保留在矩阵空间中。`)) return;
    removeFavorites(Object.values(matrix.cells));
    Object.values(matrix.cells).forEach(detachNested);
    matrix.cells = {};
    touch(matrix);
    render();
  } else if (action === 'delete') {
    requestDeleteMatrix(matrix.id);
  }
});

function setThemePanel(open) {
  elements.themePanel.classList.toggle('open', open);
  elements.themePanel.setAttribute('aria-hidden', String(!open));
  elements.scrim.classList.toggle('visible', open);
}

$('#themeBtn').addEventListener('click', () => setThemePanel(true));
$('#closeThemeBtn').addEventListener('click', () => setThemePanel(false));
elements.scrim.addEventListener('click', () => setThemePanel(false));

$('#modeControl').addEventListener('click', (event) => {
  const mode = event.target.closest('[data-mode]')?.dataset.mode;
  if (!mode) return;
  state.settings.mode = mode;
  applyTheme();
  scheduleSave();
});

$('#accentSwatches').addEventListener('click', (event) => {
  const color = event.target.closest('[data-color]')?.dataset.color;
  if (!color) return;
  state.settings.accent = color;
  applyTheme();
  scheduleSave();
});

$('#customAccent').addEventListener('input', (event) => {
  state.settings.accent = event.target.value;
  applyTheme();
  scheduleSave();
});

$('#cellColorModeControl').addEventListener('click', (event) => {
  const mode = event.target.closest('[data-cell-color-mode]')?.dataset.cellColorMode;
  if (!['type', 'cascade', 'accent'].includes(mode)) return;
  state.settings.cellColorMode = mode;
  applyTheme();
  scheduleSave();
});

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.popover') && !event.target.closest('.matrix-cell') && !event.target.closest('#moreBtn')) hidePopovers();
});

document.addEventListener('keydown', (event) => {
  const editable = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]');
  if (event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.metaKey && !event.altKey && !editable && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    if (event.repeat) return;
    state.settings.minimapVisible = !state.settings.minimapVisible;
    applyMinimapVisibility();
    scheduleSave();
    toast(state.settings.minimapVisible ? '小地图已显示' : '小地图已隐藏');
    return;
  }
  if (event.key === 'Escape') {
    hidePopovers();
    setThemePanel(false);
  }
});

$('#minimizeBtn').addEventListener('click', () => window.matrixAPI.minimize());
$('#maximizeBtn').addEventListener('click', () => window.matrixAPI.maximize());
$('#closeBtn').addEventListener('click', () => window.matrixAPI.close());
window.matrixAPI.onMaximized((maximized) => {
  $('#maximizeBtn').innerHTML = `<i data-lucide="${maximized ? 'copy' : 'square'}"></i>`;
  refreshIcons();
});

async function init() {
  state = normalizeState(await window.matrixAPI.loadWorkspace());
  applyTheme();
  render();
}

init().catch((error) => {
  console.error(error);
  state = defaultState();
  applyTheme();
  render();
  toast('工作区载入失败，已创建新的本地矩阵', true);
});
