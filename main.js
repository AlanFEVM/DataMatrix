const { app, BrowserWindow, dialog, ipcMain, nativeImage, net, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow;

const screenshotFlags = ['--screenshot', '--screenshot-demo', '--screenshot-table', '--screenshot-markdown', '--screenshot-appearance', '--screenshot-app-icon', '--screenshot-automation', '--screenshot-swap', '--screenshot-minimap', '--screenshot-favorites', '--screenshot-title'];
const isScreenshotRun = process.argv.some((argument) => screenshotFlags.includes(argument));
const testArtifacts = app.isPackaged ? path.join(app.getPath('temp'), 'DataMatrix-electron-test') : path.join(__dirname, '.artifacts');
if (isScreenshotRun) app.setPath('userData', path.join(testArtifacts, 'electron-test-profile'));
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  if (isScreenshotRun) app.exit(1);
});

const dataFile = () => path.join(app.getPath('userData'), 'workspace.json');

async function readWorkspace() {
  try {
    return JSON.parse(await fs.readFile(dataFile(), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to read workspace:', error);
    return null;
  }
}

async function writeWorkspace(data) {
  const target = dataFile();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(`${target}.tmp`, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(`${target}.tmp`, target);
  return true;
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

async function fetchPageTitle(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 网页');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await net.fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { 'User-Agent': 'DataMatrix/1.0' }
    });
    if (!response.ok) throw new Error(`网页响应异常 (${response.status})`);
    const html = (await response.text()).slice(0, 500000);
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? decodeHtml(match[1].replace(/\s+/g, ' ').trim()) : parsed.hostname;
  } finally {
    clearTimeout(timer);
  }
}

function expandWindowsEnvironmentPath(filePath) {
  return filePath.replace(/%([^%]+)%/g, (match, name) => process.env[name] || match);
}

function decodeInternetShortcut(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
    }
    return swapped.toString('utf16le');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function internetShortcutIconPath(contents, shortcutPath) {
  let section = '';
  let iconFile = '';
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      continue;
    }
    if (section !== 'internetshortcut') continue;
    const separator = line.indexOf('=');
    if (separator < 1 || line.slice(0, separator).trim().toLowerCase() !== 'iconfile') continue;
    iconFile = line.slice(separator + 1).trim().replace(/^"|"$/g, '');
    break;
  }
  if (!iconFile) return '';
  const expanded = expandWindowsEnvironmentPath(iconFile);
  return path.isAbsolute(expanded) ? expanded : path.resolve(path.dirname(shortcutPath), expanded);
}

async function iconDataUrl(candidate, preferImage = false) {
  try {
    if (preferImage) {
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) return image.toDataURL();
    }
    const icon = await app.getFileIcon(candidate, { size: 'large' });
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch {
    return null;
  }
}

async function getFileIconDataUrl(filePath) {
  try {
    if ((await fs.stat(filePath)).isDirectory()) return { dataUrl: null, kind: 'directory' };
  } catch {}

  const candidates = [];
  const extension = path.extname(filePath).toLowerCase();
  if (process.platform === 'win32' && extension === '.lnk') {
    try {
      const shortcut = shell.readShortcutLink(filePath);
      if (shortcut.icon) candidates.push({ path: expandWindowsEnvironmentPath(shortcut.icon), preferImage: true });
      if (shortcut.target) candidates.push({ path: expandWindowsEnvironmentPath(shortcut.target) });
    } catch {}
  }
  if (process.platform === 'win32' && extension === '.url') {
    try {
      const iconPath = internetShortcutIconPath(decodeInternetShortcut(await fs.readFile(filePath)), filePath);
      if (iconPath) candidates.push({ path: iconPath, preferImage: true });
    } catch {}
  }
  candidates.push({ path: filePath });

  const visited = new Set();
  for (const candidate of candidates) {
    if (!candidate.path || visited.has(candidate.path.toLowerCase())) continue;
    visited.add(candidate.path.toLowerCase());
    const dataUrl = await iconDataUrl(candidate.path, candidate.preferImage);
    if (dataUrl) return { dataUrl, kind: 'file' };
  }
  return { dataUrl: null, kind: 'file' };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f4f0',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', async () => {
    const screenshotMode = isScreenshotRun;
    if (screenshotMode) {
      await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const check = () => {
          if (typeof state !== 'undefined' && state?.matrices) return resolve(true);
          if (Date.now() - startedAt > 5000) return reject(new Error('Renderer initialization timed out'));
          setTimeout(check, 25);
        };
        check();
      })`);
      if (process.argv.includes('--screenshot-demo')) {
        const samplePath = path.join(testArtifacts, 'data-matrix.png');
        await mainWindow.webContents.executeJavaScript(`
          activeMatrix().cells['0:0'] = { type: 'file', title: '图片预览测试', value: ${JSON.stringify(samplePath)} };
          renderGrid();
          refreshIcons();
          document.querySelector('#themeBtn').click();
        `);
      }
      if (process.argv.includes('--screenshot-table')) {
        const tableResult = await mainWindow.webContents.executeJavaScript(`
          openTableEditor(0, 0);
          document.querySelector('#addTableColumnBtn').click();
          document.querySelector('#addTableColumnBtn').click();
          let typeControls = document.querySelectorAll('[data-column-type]');
          typeControls[3].value = 'boolean';
          typeControls[3].dispatchEvent(new Event('change', { bubbles: true }));
          typeControls = document.querySelectorAll('[data-column-type]');
          typeControls[4].value = 'url';
          typeControls[4].dispatchEvent(new Event('change', { bubbles: true }));
          document.querySelector('#addTableRowBtn').click();
          document.querySelector('#tableForm').requestSubmit();
          const savedTableCell = activeMatrix().cells['0:0'];
          openTableEditor(0, 0, savedTableCell);
          ({ cellType: savedTableCell.type, columns: tableDraft.columns.length, rows: tableDraft.rows.length, types: tableDraft.columns.map((column) => column.type) });
        `);
        console.log('Table smoke test:', tableResult);
      }
      if (process.argv.includes('--screenshot-markdown')) {
        const markdownSample = '# 项目记录\n\n## 今日状态\n\n- [x] 完成数据结构\n- [ ] 整理下一步\n\n| 字段 | 类型 |\n| --- | --- |\n| 数量 | number |\n\n```js\nconst ready = true;\n```\n\n[OpenAI](https://openai.com)';
        const markdownResult = await mainWindow.webContents.executeJavaScript(`
          openMarkdownEditor(0, 0);
          document.querySelector('#markdownTitleInput').value = '项目记录';
          document.querySelector('#markdownInput').value = ${JSON.stringify(markdownSample)};
          document.querySelector('#markdownInput').dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('#markdownForm').requestSubmit();
          const savedMarkdownCell = activeMatrix().cells['0:0'];
          openMarkdownEditor(0, 0, savedMarkdownCell);
          ({ cellType: savedMarkdownCell.type, length: savedMarkdownCell.value.length, headings: document.querySelectorAll('#markdownPreview h1, #markdownPreview h2').length, tables: document.querySelectorAll('#markdownPreview table').length, codeBlocks: document.querySelectorAll('#markdownPreview pre').length });
        `);
        console.log('Markdown smoke test:', markdownResult);
      }
      if (process.argv.includes('--screenshot-appearance')) {
        const appearanceResult = await mainWindow.webContents.executeJavaScript(`
          activeMatrix().cells['0:0'] = { type: 'text', title: '重点项目', value: '本周需要优先推进' };
          render();
          openAppearanceEditor(0, 0, activeMatrix().cells['0:0']);
          document.querySelector('[data-cell-color="#d05e43"]').click();
          document.querySelector('[data-cell-emoji="🚀"]').click();
          document.querySelector('#appearanceForm').requestSubmit();
          let savedAppearanceCell = activeMatrix().cells['0:0'];
          openEditor('text', 0, 0, savedAppearanceCell);
          document.querySelector('#cellValueInput').value = '外观应在内容编辑后保留';
          document.querySelector('#editorForm').requestSubmit();
          savedAppearanceCell = activeMatrix().cells['0:0'];
          const renderedAppearanceCell = document.querySelector('.matrix-cell[data-row="0"][data-col="0"]');
          const appearanceStatus = { color: savedAppearanceCell.appearance.color, emoji: savedAppearanceCell.appearance.emoji, preservedAfterEdit: savedAppearanceCell.value === '外观应在内容编辑后保留', customClass: renderedAppearanceCell.classList.contains('has-custom-color'), cssColor: getComputedStyle(renderedAppearanceCell).getPropertyValue('--cell-color').trim() };
          openAppearanceEditor(0, 0, savedAppearanceCell);
          appearanceStatus;
        `);
        console.log('Appearance smoke test:', appearanceResult);
      }
      if (process.argv.includes('--screenshot-app-icon')) {
        const associatedFilePath = path.join(__dirname, 'renderer', 'index.html');
        const appIconResult = await mainWindow.webContents.executeJavaScript(`(async () => {
          activeMatrix().cells['0:0'] = { type: 'file', title: 'index.html', value: ${JSON.stringify(associatedFilePath)} };
          render();
          await new Promise((resolve) => setTimeout(resolve, 700));
          const iconImage = document.querySelector('[data-app-icon]');
          return { loaded: iconImage?.closest('.cell-icon')?.classList.contains('has-system-icon') || false, dataUrl: iconImage?.src?.startsWith('data:image/png') || false, naturalWidth: iconImage?.naturalWidth || 0 };
        })()`);
        console.log('Associated file icon smoke test:', appIconResult);
      }
      if (process.argv.includes('--screenshot-automation')) {
        await fs.mkdir(testArtifacts, { recursive: true });
        const shortcutPath = path.join(testArtifacts, 'DataMatrix Test.lnk');
        const urlShortcutPath = path.join(testArtifacts, 'DataMatrix Website.url');
        const systemAppPath = process.platform === 'win32'
          ? path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'notepad.exe')
          : process.execPath;
        await fs.rm(shortcutPath, { force: true });
        const shortcutCreated = process.platform === 'win32' && shell.writeShortcutLink(shortcutPath, {
          target: systemAppPath,
          cwd: path.dirname(systemAppPath),
          icon: systemAppPath,
          iconIndex: 0,
          description: 'DataMatrix shortcut icon test'
        });
        await fs.writeFile(urlShortcutPath, `[InternetShortcut]\r\nURL=https://example.com/\r\nIconFile=${systemAppPath}\r\nIconIndex=0\r\n`, 'utf8');
        const automationPath = shortcutCreated ? shortcutPath : process.execPath;
        const automationResult = await mainWindow.webContents.executeJavaScript(`(async () => {
          activeMatrix().rows = 3;
          activeMatrix().cols = 4;
          activeMatrix().cells = {};
          render();
          resetHistory();
          assignFiles([${JSON.stringify(automationPath)}, ${JSON.stringify(testArtifacts)}, ${JSON.stringify(urlShortcutPath)}], 0, 0);
          await new Promise((resolve) => setTimeout(resolve, 900));
          const card = document.querySelector('.matrix-cell[data-row="0"][data-col="0"]');
          const iconImage = card?.querySelector('[data-app-icon]');
          const iconLoaded = iconImage?.closest('.cell-icon')?.classList.contains('has-system-icon') || false;
          const adaptiveColor = card?.classList.contains('has-adaptive-color') && Boolean(getComputedStyle(card).getPropertyValue('--app-color').trim());
          const shortcutTitle = activeMatrix().cells['0:0']?.title;
          const folderCard = document.querySelector('.matrix-cell[data-row="0"][data-col="1"]');
          const folderIconCorrect = Boolean(folderCard?.querySelector('.lucide-folder'));
          const folderSystemIconHidden = !folderCard?.querySelector('.cell-icon')?.classList.contains('has-system-icon');
          const urlCard = document.querySelector('.matrix-cell[data-row="0"][data-col="2"]');
          const urlIconLoaded = urlCard?.querySelector('.cell-icon')?.classList.contains('has-system-icon') || false;
          const urlShortcutTitle = activeMatrix().cells['0:2']?.title;
          const rowsBefore = activeMatrix().rows;
          document.querySelector('#addRowBtn').click();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 80));
          const undoRestoredRows = activeMatrix().rows === rowsBefore;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 80));
          const redoRestoredRows = activeMatrix().rows === rowsBefore + 1;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 80));
          return {
            shortcutCreated: ${JSON.stringify(Boolean(shortcutCreated))},
            shortcutTitle,
            iconLoaded,
            adaptiveColor,
            folderIconCorrect,
            folderSystemIconHidden,
            urlIconLoaded,
            urlShortcutTitle,
            undoRestoredRows,
            redoRestoredRows,
            finalRowsRestored: activeMatrix().rows === rowsBefore
          };
        })()`);
        console.log('Shortcut, adaptive color, and undo smoke test:', automationResult);
      }
      if (process.argv.includes('--screenshot-swap')) {
        mainWindow.showInactive();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const swapResult = await mainWindow.webContents.executeJavaScript(`(() => {
          activeMatrix().cells['0:0'] = { type: 'text', title: '任务 A', value: '第一个单元格', appearance: { color: '#476fbd', emoji: '📌' } };
          activeMatrix().cells['0:1'] = { type: 'text', title: '任务 B', value: '第二个单元格', appearance: { color: '#d05e43', emoji: '🚀' } };
          render();
          const dispatchSwap = (pointerId, release) => {
            const source = document.querySelector('.matrix-cell[data-row="0"][data-col="0"]');
            const target = document.querySelector('.matrix-cell[data-row="0"][data-col="1"]');
            const sourceRect = source.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            source.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2, buttons: 2, pointerId, clientX: sourceRect.left + 30, clientY: sourceRect.top + 30 }));
            document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: -1, buttons: 2, pointerId, clientX: targetRect.left + 60, clientY: targetRect.top + 55 }));
            if (release) document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 2, buttons: 0, pointerId, clientX: targetRect.left + 60, clientY: targetRect.top + 55 }));
          };
          dispatchSwap(41, true);
          const swapped = activeMatrix().cells['0:0'].title === '任务 B' && activeMatrix().cells['0:1'].title === '任务 A';
          swapCells(0, 1, 0, 2);
          const movedToEmpty = !activeMatrix().cells['0:1'] && activeMatrix().cells['0:2'].title === '任务 A';
          swapCells(0, 2, 0, 1);
          dispatchSwap(42, false);
          return { swapped, movedToEmpty, dragging: document.body.classList.contains('is-swapping'), targetHighlighted: Boolean(document.querySelector('.swap-target')), ghostVisible: Boolean(document.querySelector('.swap-ghost')) };
        })()`);
        console.log('Right-button swap smoke test:', swapResult);
      }
      if (process.argv.includes('--screenshot-minimap')) {
        mainWindow.showInactive();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const minimapResult = await mainWindow.webContents.executeJavaScript(`(() => {
          const matrix = activeMatrix();
          state.settings.mode = 'dark';
          state.settings.colorful = true;
          state.settings.minimapVisible = true;
          applyTheme();
          matrix.rows = 8;
          matrix.cols = 10;
          matrix.cells = {
            '0:0': { type: 'text', title: '计划', value: '', appearance: { color: '#2f7d68' } },
            '0:3': { type: 'link', title: '资源', value: 'https://example.com' },
            '1:1': { type: 'markdown', title: '文档', value: '# 文档', appearance: { color: '#c04867' } },
            '2:4': { type: 'table', title: '数据', value: { columns: [], rows: [] } },
            '3:2': { type: 'matrix', title: '子矩阵', matrixId: 'missing', appearance: { color: '#7b5daa' } },
            '4:6': { type: 'text', title: '重点', value: '', appearance: { color: '#d05e43' } },
            '5:8': { type: 'text', title: '进度', value: '', appearance: { color: '#a56b2a' } },
            '7:9': { type: 'text', title: '归档', value: '', appearance: { color: '#476fbd' } }
          };
          render();
          drawMinimap();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
          const hiddenByM = document.querySelector('#minimap').hidden;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', bubbles: true }));
          const restoredByM = !document.querySelector('#minimap').hidden;
          drawMinimap();
          const canvas = document.querySelector('#canvas');
          const canvasRect = canvas.getBoundingClientRect();
          canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 1, buttons: 4, pointerId: 71, clientX: canvasRect.left + 500, clientY: canvasRect.top + 350 }));
          document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: -1, buttons: 4, pointerId: 71, clientX: canvasRect.left + 330, clientY: canvasRect.top + 230 }));
          document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 1, buttons: 0, pointerId: 71, clientX: canvasRect.left + 330, clientY: canvasRect.top + 230 }));
          const afterPan = { left: canvas.scrollLeft, top: canvas.scrollTop };
          drawMinimap();
          const map = document.querySelector('#minimapCanvas');
          const mapRect = map.getBoundingClientRect();
          map.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 72, clientX: mapRect.left + mapRect.width * .78, clientY: mapRect.top + mapRect.height * .76 }));
          map.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, pointerId: 72, clientX: mapRect.left + mapRect.width * .78, clientY: mapRect.top + mapRect.height * .76 }));
          drawMinimap();
          const backgroundPixel = Array.from(map.getContext('2d').getImageData(1, 1, 1, 1).data);
          return { hiddenByM, restoredByM, theme: document.body.dataset.theme, middlePanMoved: afterPan.left > 0 && afterPan.top > 0, minimapNavigated: canvas.scrollLeft !== afterPan.left || canvas.scrollTop !== afterPan.top, scrollLeft: canvas.scrollLeft, scrollTop: canvas.scrollTop, scale: minimapMetrics.scale, scrollbarWidth: getComputedStyle(canvas).scrollbarWidth, backgroundPixel };
        })()`);
        console.log('Minimap and middle-pan smoke test:', minimapResult);
      }
      if (process.argv.includes('--screenshot-favorites')) {
        const favoritesResult = await mainWindow.webContents.executeJavaScript(`(async () => {
          state = defaultState();
          const root = activeMatrix();
          root.title = '项目控制台';
          root.rows = 4;
          root.cols = 5;
          const planCell = { id: uid(), type: 'text', title: '本周计划', value: '整理发布清单', appearance: { emoji: '📌' } };
          const linkCell = { id: uid(), type: 'link', title: '设计资源', value: 'https://example.com' };
          const customCell = { id: uid(), type: 'markdown', title: '会议记录', value: '# 会议记录', appearance: { color: '#c04867', emoji: '📝' } };
          const nested = createMatrix('资料矩阵', root.id, 2, 3);
          const deepNested = createMatrix('素材归档', nested.id, 2, 2);
          const draggedMatrix = createMatrix('创意仓库', null, 2, 2);
          const nestedCell = { id: uid(), type: 'table', title: '客户数据', value: { columns: [], rows: [] }, appearance: { emoji: '📊' } };
          const matrixCell = { id: uid(), type: 'matrix', title: nested.title, matrixId: nested.id };
          const deepMatrixCell = { id: uid(), type: 'matrix', title: deepNested.title, matrixId: deepNested.id };
          nested.cells['0:0'] = nestedCell;
          nested.cells['0:1'] = deepMatrixCell;
          state.matrices[nested.id] = nested;
          state.matrices[deepNested.id] = deepNested;
          state.matrices[draggedMatrix.id] = draggedMatrix;
          root.cells = { '0:0': planCell, '0:2': linkCell, '1:1': customCell, '2:3': matrixCell };
          state.favorites = [planCell.id, nestedCell.id, matrixCell.id];
          state.settings.mode = 'dark';
          state.settings.accent = '#2f7d68';
          state.settings.cellColorMode = 'cascade';
          state.settings.minimapVisible = true;
          applyTheme();
          render();

          document.querySelector('[data-matrix-favorite="' + root.id + '"]').click();
          const matrixFavoriteAdded = state.matrixFavorites.includes(root.id);
          const matrixFavoriteRendered = Boolean(document.querySelector('[data-favorite-matrix-id="' + root.id + '"]'));
          syncMatrixFavoriteAction(root.id);
          const matrixFavoriteMenuLabel = document.querySelector('#favoriteMatrixAction span').textContent;
          state.activeMatrixId = nested.id;
          render();
          document.querySelector('[data-favorite-matrix-id="' + root.id + '"]').click();
          const matrixFavoriteNavigated = state.activeMatrixId === root.id;

          let contextTarget = document.querySelector('[data-tree-matrix-id="' + nested.id + '"]');
          const contextRect = contextTarget.getBoundingClientRect();
          contextTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: contextRect.right - 12, clientY: contextRect.bottom }));
          const matrixContextMenuVisible = !document.querySelector('#matrixContextMenu').hidden;
          document.querySelector('[data-matrix-context-action="appearance"]').click();
          const matrixAppearanceDialogOpened = document.querySelector('#matrixAppearanceDialog').open;
          document.querySelector('[data-matrix-color="#d05e43"]').click();
          document.querySelector('[data-matrix-icon="folder"]').click();
          document.querySelector('#matrixAppearanceForm').requestSubmit();
          const matrixAppearanceSaved = nested.appearance?.color === '#d05e43' && nested.appearance?.icon === 'folder';
          const styledTreeRow = document.querySelector('[data-tree-matrix-id="' + nested.id + '"]');
          const styledMatrixCell = document.querySelector('.matrix-cell[data-row="2"][data-col="3"]');
          const matrixAppearancePropagated = styledTreeRow.classList.contains('has-matrix-color') && styledMatrixCell.classList.contains('has-matrix-color') && Boolean(styledMatrixCell.querySelector('.lucide-folder'));
          contextTarget = document.querySelector('[data-tree-matrix-id="' + nested.id + '"]');
          contextTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: contextRect.right - 12, clientY: contextRect.bottom }));
          document.querySelector('[data-matrix-context-action="rename"]').click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const contextRenameFocused = state.activeMatrixId === nested.id && document.activeElement === document.querySelector('#matrixTitle');
          navigate(root.id);

          const dragData = new DataTransfer();
          const dragSource = document.querySelector('[data-matrix-id="' + draggedMatrix.id + '"]');
          const dragTarget = document.querySelector('.matrix-cell[data-row="0"][data-col="4"]');
          dragSource.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dragData }));
          dragTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dragData }));
          const treeDragVisual = dragTarget.classList.contains('matrix-drop-target') && document.body.classList.contains('matrix-tree-drag');
          dragTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dragData }));
          const treeDragAttached = root.cells['0:4']?.matrixId === draggedMatrix.id && draggedMatrix.parentId === root.id;
          const cyclePrevented = !attachMatrixToCell(root.id, 0, 1) && !root.cells['0:1'];

          const favoriteCount = document.querySelectorAll('[data-favorite-id]').length;
          syncFavoriteAction(planCell);
          const favoriteMenuLabel = document.querySelector('#favoriteCellAction span').textContent;
          toggleFavorite(planCell);
          const removedByToggle = !state.favorites.includes(planCell.id);
          toggleFavorite(planCell);
          swapCells(0, 0, 1, 3);
          const movedFavorite = findCellById(planCell.id);
          await openFavorite(planCell.id);
          const favoriteOpened = targetCell?.row === 1 && targetCell?.col === 3 && !document.querySelector('#cellMenu').hidden;
          hidePopovers();

          let treeToggle = document.querySelector('[data-tree-toggle]');
          treeToggle.click();
          const collapsed = state.settings.collapsedMatrices.includes(root.id) && !document.querySelector('[data-matrix-id="' + nested.id + '"]');
          treeToggle = document.querySelector('[data-tree-toggle]');
          treeToggle.click();
          const expanded = !state.settings.collapsedMatrices.includes(root.id) && Boolean(document.querySelector('[data-matrix-id="' + nested.id + '"]'));

          const temporary = { id: uid(), type: 'text', title: '临时数据', value: '' };
          root.cells['3:4'] = temporary;
          state.favorites.push(temporary.id);
          removeFavorites([temporary]);
          delete root.cells['3:4'];
          const deletionCleaned = !state.favorites.includes(temporary.id);
          const temporaryMatrix = createMatrix('临时矩阵');
          state.matrices[temporaryMatrix.id] = temporaryMatrix;
          state.matrixFavorites.push(temporaryMatrix.id);
          removeMatrix(temporaryMatrix.id);
          const matrixFavoriteDeletionCleaned = !state.matrixFavorites.includes(temporaryMatrix.id);
          const rootDeleteGuarded = !requestDeleteMatrix(root.id) && Boolean(state.matrices[root.id]);

          render();
          const deepTreeItem = document.querySelector('[data-matrix-id="' + deepNested.id + '"]');
          const treeIndentMetrics = {
            inlineIndent: deepTreeItem?.parentElement?.style.getPropertyValue('--indent'),
            computedIndent: getComputedStyle(deepTreeItem?.parentElement).getPropertyValue('--indent').trim(),
            paddingLeft: getComputedStyle(deepTreeItem).paddingLeft,
            itemLeft: Math.round(deepTreeItem.getBoundingClientRect().left)
          };
          drawMinimap();
          const cascadeColors = Array.from(document.querySelectorAll('.matrix-cell:not(.empty):not(.has-custom-color)')).map((cell) => getComputedStyle(cell).getPropertyValue('--cascade-color').trim());
          const customStyle = getComputedStyle(document.querySelector('.matrix-cell.has-custom-color')).getPropertyValue('--cell-color').trim();
          state.settings.mode = 'light';
          applyTheme();
          renderGrid();
          const lightCascadeColors = Array.from(document.querySelectorAll('.matrix-cell:not(.empty):not(.has-custom-color)')).map((cell) => getComputedStyle(cell).getPropertyValue('--cascade-color').trim());
          state.settings.mode = 'dark';
          applyTheme();
          render();
          drawMinimap();
          const map = document.querySelector('#minimapCanvas');
          const mapPixels = map.getContext('2d').getImageData(0, 0, map.width, map.height).data;
          const minimapDrawn = Array.from(mapPixels).some((value, index) => index % 4 !== 3 && value > 0);
          elements.toastRegion.innerHTML = '';
          setThemePanel(false);
          const visualContextTarget = document.querySelector('[data-tree-matrix-id="' + nested.id + '"]');
          const visualContextRect = visualContextTarget.getBoundingClientRect();
          visualContextTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: visualContextRect.right - 8, clientY: visualContextRect.top + 8 }));
          document.querySelector('[data-matrix-context-action="appearance"]').click();
          return {
            favoriteCount,
            matrixFavoriteAdded,
            matrixFavoriteRendered,
            matrixFavoriteMenuLabel,
            matrixFavoriteNavigated,
            matrixContextMenuVisible,
            matrixAppearanceDialogOpened,
            matrixAppearanceSaved,
            matrixAppearancePropagated,
            contextRenameFocused,
            treeDragVisual,
            treeDragAttached,
            treeDragVisibleInTree: Boolean(document.querySelector('[data-matrix-id="' + draggedMatrix.id + '"]')),
            cyclePrevented,
            favoriteMenuLabel,
            removedByToggle,
            movedFavorite: movedFavorite?.row === 1 && movedFavorite?.col === 3,
            favoriteOpened,
            collapsed,
            expanded,
            deletionCleaned,
            matrixFavoriteDeletionCleaned,
            rootDeleteGuarded,
            treeIndentMetrics,
            cascadeClass: document.body.classList.contains('cascade-cells'),
            distinctCascadeColors: new Set(cascadeColors).size > 1,
            lightCascadeColors: new Set(lightCascadeColors).size > 1,
            customColorPreserved: customStyle === '#c04867',
            minimapDrawn
          };
        })()`);
        console.log('Favorites, collapse and cascade smoke test:', favoritesResult);
      }
      if (process.argv.includes('--screenshot-title')) {
        await mainWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          let attempts = 0;
          const check = () => {
            if (typeof state !== 'undefined' && state?.matrices) return resolve(true);
            if (++attempts > 100) return reject(new Error('Workspace initialization timed out'));
            setTimeout(check, 20);
          };
          check();
        })`);
        const titleResult = await mainWindow.webContents.executeJavaScript(`(() => {
          try {
            const title = document.querySelector('#matrixTitle');
            title.focus();
            title.select();
            title.value = '可命名矩阵';
            title.dispatchEvent(new Event('input', { bubbles: true }));
            const style = getComputedStyle(title);
            const treeLabel = document.querySelector('[data-matrix-id="' + activeMatrix().id + '"] .tree-label');
            return {
              focused: document.activeElement === title,
              selectionStart: title.selectionStart,
              selectionEnd: title.selectionEnd,
              userSelect: style.userSelect,
              cursor: style.cursor,
              caretColor: style.caretColor,
              renamed: activeMatrix().title === '可命名矩阵',
              treeUpdated: treeLabel?.textContent === '可命名矩阵'
            };
          } catch (error) {
            return { error: error.stack || String(error) };
          }
        })()`);
        console.log('Matrix title editing smoke test:', titleResult);
      }
      mainWindow.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 1400));
      const image = await mainWindow.webContents.capturePage();
      const outputDir = testArtifacts;
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(path.join(outputDir, 'data-matrix.png'), image.toPNG());
      app.quit();
      return;
    }
    mainWindow.show();
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

app.whenReady().then(() => {
  ipcMain.handle('workspace:load', readWorkspace);
  ipcMain.handle('workspace:save', (_event, data) => writeWorkspace(data));
  ipcMain.handle('file:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件或应用程序',
      properties: ['openFile', 'multiSelections']
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('file:open', async (_event, filePath) => shell.openPath(filePath));
  ipcMain.handle('file:thumbnail', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return null;
    try {
      const image = await nativeImage.createThumbnailFromPath(filePath, { width: 380, height: 264 });
      return image.isEmpty() ? null : image.toDataURL();
    } catch {
      return null;
    }
  });
  ipcMain.handle('file:icon', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return null;
    return getFileIconDataUrl(filePath);
  });
  ipcMain.handle('link:open', async (_event, url) => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return false;
      await shell.openExternal(parsed.toString());
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('link:title', async (_event, url) => fetchPageTitle(url));
  ipcMain.handle('window:minimize', () => mainWindow.minimize());
  ipcMain.handle('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  ipcMain.handle('window:close', () => mainWindow.close());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
