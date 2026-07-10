const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const url = require('url');

// Prevent multiple Electron instances from conflicting
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let win = null;
let config = null;
let names = null;

const projectDir = __dirname;

// Dynamically resolve writable User Data directory
let userDataPath = path.join(projectDir, 'data');
try {
  if (app && typeof app.getPath === 'function') {
    userDataPath = app.getPath('userData');
  }
} catch (e) {
  // Standalone node environment fallback
}

const configPath = path.join(userDataPath, 'config.json');
const txtPath = path.join(userDataPath, 'isimler.txt');

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const txtContent = fs.readFileSync(txtPath, 'utf8');
  names = txtContent.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
} catch (err) {
  console.error('[Record Job] Error reading configuration:', err);
  process.exit(1);
}

// Base scroll parameters
const baseFontSize = config.fontSize || 80;
const nameHeight = config.nameHeight || 160;
const scrollSpeed = config.scrollSpeed || 3;
const fps = config.fps || 60;
const width = config.width || 1920;
const height = config.height || 1080;

// Read total list height from lineCache.json (written by pre-render.js)
const cachePath = path.join(userDataPath, 'lineCache.json');
let totalListHeight = names.length * nameHeight;
if (fs.existsSync(cachePath)) {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    totalListHeight = cache.totalListHeight || totalListHeight;
    console.log(`[Record Job] lineCache totalListHeight: ${totalListHeight}px`);
  } catch (e) {
    console.warn('[Record Job] Could not parse lineCache.json, using fallback height.');
  }
}

const totalScrollDistance = height + totalListHeight;
const pixelsPerSecond = scrollSpeed * fps;
const scrollDuration = totalScrollDistance / pixelsPerSecond;

const introDuration = 2;
const outroDuration = 3;
const totalDuration = introDuration + scrollDuration + outroDuration;

console.log(`[Record Job] Scroll=${scrollDuration.toFixed(2)}s, Total=${totalDuration.toFixed(2)}s`);

function createWindow() {
  const isTransparent = config.format === 'transparent';

  win = new BrowserWindow({
    width: width,
    height: height,
    useContentSize: true,
    frame: false,
    // show:true required for desktopCapturer to capture the window content,
    // but we move it fully off-screen so it never appears in front of the user.
    show: true,
    x: -width - 100,
    y: -height - 100,
    transparent: isTransparent,
    backgroundColor: isTransparent ? '#00000000' : '#000814',
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'record-preload.js')
    }
  });

  // Move off-screen so user never sees it
  win.setPosition(-width - 100, -height - 100);

  // Handle stream ID requests from the renderer
  ipcMain.handle('get-stream-id', () => {
    return win.getMediaSourceId();
  });

  // Handle recorded chunks payload
  ipcMain.on('recording-complete', (event, arrayBuffer) => {
    console.log('[Record Job] WebM chunks received from renderer. Writing temp file...');
    const tempWebmPath = path.join(app.getPath('temp'), `recording_${Date.now()}.webm`);
    const buffer = Buffer.from(arrayBuffer);
    
    fs.writeFileSync(tempWebmPath, buffer);
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    console.log(`[Record Job] Temp WebM: ${tempWebmPath} (${sizeMB} MB)`);

    processVideo(tempWebmPath);
  });

  win.loadFile(path.join(__dirname, 'renderer.html'));

  win.webContents.on('did-finish-load', () => {
    console.log('[Record Job] renderer.html loaded. Injecting config and starting...');
    
    const fontFile = 'OptimaNovaLTProRegular.otf';
    const fontPath = url.pathToFileURL(path.join(projectDir, 'public', 'fonts', fontFile)).href;
    
    // Check if a custom template exists in writable userDataPath, otherwise use default
    let bgFilePath = path.join(userDataPath, 'sablon.jpg');
    if (!fs.existsSync(bgFilePath)) {
      bgFilePath = path.join(projectDir, 'public', 'sablon.jpg');
    }
    const bgPath = url.pathToFileURL(bgFilePath).href;

    const renderConfig = {
      bgPath: isTransparent ? null : bgPath,
      fontPath: fontPath,
      fontFamily: 'Optima Nova LT Pro',
      fontSize: baseFontSize,
      textColor: config.textColor,
      fontWeight: config.fontWeight,
      letterSpacing: parseFloat(config.letterSpacing) || 1.5,
      nameHeight: nameHeight,
      maskTopPercent: config.maskTopPercent,
      maskBottomPercent: config.maskBottomPercent,
      names: names,
      width: width,
      height: height,
      scrollDuration: scrollDuration
    };

    win.webContents.executeJavaScript(`
      window.initPage(${JSON.stringify(renderConfig)});
      window.START_RECORDING();
    `).catch(err => {
      console.error('[Record Job] executeJavaScript error:', err);
    });

    // Progress logging + auto-stop
    let secondsElapsed = 0;
    const progressInterval = setInterval(() => {
      secondsElapsed += 1;
      const pct = Math.min(100, Math.round((secondsElapsed / totalDuration) * 100));
      console.log(`İlerleme: %${pct}`);
      
      if (secondsElapsed >= totalDuration) {
        clearInterval(progressInterval);
        console.log('[Record Job] Duration reached. Stopping recording...');
        win.webContents.executeJavaScript('window.STOP_RECORDING()').catch(() => {});
      }
    }, 1000);
  });

  win.webContents.on('console-message', (event, level, message) => {
    console.log(`[Renderer] ${message}`);
  });
}

app.whenReady().then(() => {
  createWindow();
});

function processVideo(webmPath) {
  const isTransparent = config.format === 'transparent';
  
  // Use the absolute outputDir written by server.js into config.json
  // Fall back to a sensible default if missing
  let outDir = config.outputDir;
  if (!outDir || !path.isAbsolute(outDir)) {
    outDir = path.join(projectDir, '..', 'out');
    console.warn(`[Record Job] config.outputDir missing or relative — using fallback: ${outDir}`);
  }
    
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`[Record Job] Created output directory: ${outDir}`);
  }

  const safeDeptName = (config.departmentName || 'video').replace(/[^a-zA-Z0-9 ıIğGüşŞöÖçÇ]/g, '').trim();
  const fileExt = isTransparent ? 'webm' : 'mp4';
  const outPath = path.join(outDir, `graduation_${safeDeptName}.${fileExt}`);

  console.log(`[Record Job] Output path: ${outPath}`);

  if (isTransparent) {
    try {
      fs.copyFileSync(webmPath, outPath);
      fs.unlinkSync(webmPath);
      const exists = fs.existsSync(outPath);
      console.log(`[Record Job] Transparent WebM saved: ${outPath} — exists: ${exists}`);
      app.quit();
    } catch(err) {
      console.error('[Record Job] Error saving transparent WebM:', err);
      app.quit();
    }
  } else {
    console.log('[Record Job] Starting FFmpeg transcode...');
    
    // Find FFmpeg — bundled with Remotion
    let ffmpegPath = path.join(projectDir, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');
    if (!fs.existsSync(ffmpegPath)) {
      ffmpegPath = path.join(projectDir, '..', 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');
    }
    if (!fs.existsSync(ffmpegPath)) {
      console.error(`[Record Job] FFmpeg not found! Tried: ${ffmpegPath}`);
      app.quit();
      return;
    }
    console.log(`[Record Job] FFmpeg path: ${ffmpegPath}`);

    const ffmpegArgs = [
      '-y',
      '-i', webmPath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      outPath
    ];

    console.log(`[Record Job] FFmpeg command: ${ffmpegPath} ${ffmpegArgs.join(' ')}`);

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

    ffmpegProcess.stdout.on('data', (data) => {
      console.log(`[FFmpeg stdout] ${data.toString().trim()}`);
    });

    ffmpegProcess.stderr.on('data', (data) => {
      // FFmpeg writes progress to stderr by default
      console.log(`[FFmpeg] ${data.toString().trim()}`);
    });

    ffmpegProcess.on('error', (err) => {
      console.error(`[Record Job] FFmpeg spawn error: ${err.message}`);
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`[Record Job] FFmpeg exited with code: ${code}`);
      try { fs.unlinkSync(webmPath); } catch (e) {}
      const exists = fs.existsSync(outPath);
      if (code === 0 && exists) {
        console.log(`[Record Job] MP4 saved successfully: ${outPath}`);
      } else {
        console.error(`[Record Job] FFmpeg failed (code ${code}), file exists: ${exists}`);
      }
      app.quit();
    });
  }
}
