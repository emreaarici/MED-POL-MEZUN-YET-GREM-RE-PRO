const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const url = require('url');

// Enable GPU Hardware Acceleration (required for fast capturePage and to prevent UnknownVizError on some PCs)
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');

// ─────────────────────────────────────────────────────────────
// RECORD MODE: launched with --record flag by server.js
// Offscreen rendering → paint events → FFmpeg stdin pipe
// ─────────────────────────────────────────────────────────────
const isRecordMode = process.argv.includes('--record');

if (isRecordMode) {

  // Force 1:1 device pixel ratio to prevent DPI scaling from changing
  // the offscreen buffer dimensions (e.g. 125% DPI → 1538x817 instead of 1920x1080)
  app.commandLine.appendSwitch('force-device-scale-factor', '1');

  let win = null;
  let config = null;
  let names = null;

  const projectDir = __dirname;
  const configPath = path.join(projectDir, 'src', 'config.json');
  const txtPath = path.join(projectDir, 'isimler.txt');

  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const txtContent = fs.readFileSync(txtPath, 'utf8');
    names = txtContent.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch (err) {
    console.error('[Record Job] Error reading configuration:', err);
    process.exit(1);
  }

  const baseFontSize = config.fontSize || 80;
  const nameHeight   = config.nameHeight || 160;
  const scrollSpeed  = config.scrollSpeed || 3;
  const configFps    = config.fps || 60;
  const width        = config.width || 1920;
  const height       = config.height || 1080;

  // Keep dynamic recording FPS matching the user configuration (e.g., 60 FPS for buttery smooth scrolls)
  const recordFps = configFps;

  const cachePath = path.join(projectDir, 'src', 'lineCache.json');
  let totalListHeight = names.length * nameHeight;
  if (fs.existsSync(cachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      totalListHeight = cache.totalListHeight || totalListHeight;
      console.log(`[Record Job] lineCache totalListHeight: ${totalListHeight}px`);
    } catch (e) {
      console.warn('[Record Job] lineCache parse error, using fallback.');
    }
  }

  const totalScrollDistance = height + totalListHeight;
  const pixelsPerSecond     = scrollSpeed * configFps;
  const scrollDuration      = totalScrollDistance / pixelsPerSecond;
  const introDuration       = 2;
  const outroDuration       = 3;
  const totalDuration       = introDuration + scrollDuration + outroDuration;
  const totalFrames         = Math.ceil(totalDuration * recordFps);

  console.log(`[Record Job] Scroll=${scrollDuration.toFixed(2)}s  Total=${totalDuration.toFixed(2)}s`);
  console.log(`[Record Job] Capture: ${recordFps}fps × ${totalFrames} frames`);

  // Find FFmpeg (cross-platform lookup)
  let ffmpegPath = 'ffmpeg'; // Default to system-wide global 'ffmpeg' command (for macOS/Linux)

  if (process.platform === 'win32') {
    let localWinFfmpeg = path.join(projectDir, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');
    if (!fs.existsSync(localWinFfmpeg)) {
      localWinFfmpeg = path.join(projectDir, '..', 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');
    }
    if (fs.existsSync(localWinFfmpeg)) {
      ffmpegPath = localWinFfmpeg;
    } else {
      console.warn('[Record Job] Bundled Windows FFmpeg not found, falling back to system global "ffmpeg"');
    }
  }

  console.log(`[Record Job] Using FFmpeg binary: ${ffmpegPath}`);

  app.whenReady().then(() => {
    const isTransparent = config.format === 'transparent';

    // ── Headless Offscreen BrowserWindow ─────────────────────
    // Renders purely into an off-screen graphics memory buffer.
    // Highly compatible and lightweight. We add a startup delay in the loop
    // to give the GPU compositor time to allocate textures and avoid UnknownVizError.
    win = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      show: false,
      transparent: isTransparent,
      backgroundColor: isTransparent ? '#00000000' : '#000814',
      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.webContents.on('console-message', (event, level, message) => {
      console.log(`[Renderer] ${message}`);
    });

    win.loadFile(path.join(__dirname, 'renderer.html'));

    win.webContents.on('did-finish-load', async () => {
      console.log('[Record Job] renderer.html loaded. Injecting config...');

      const fontFile = 'OptimaNovaLTProRegular.otf';
      const fontPath = url.pathToFileURL(path.join(projectDir, 'public', 'fonts', fontFile)).href;
      const bgPath   = url.pathToFileURL(path.join(projectDir, 'public', 'sablon.jpg')).href;

      const renderConfig = {
        bgPath:           isTransparent ? null : bgPath,
        fontPath,
        fontFamily:       config.fontFamily || 'Optima Nova LT Pro',
        fontSize:         baseFontSize,
        textColor:        config.textColor,
        fontWeight:       config.fontWeight,
        letterSpacing:    parseFloat(config.letterSpacing) || 1.5,
        nameHeight,
        maskTopPercent:   config.maskTopPercent,
        maskBottomPercent: config.maskBottomPercent,
        names,
        width,
        height,
        scrollDuration,
        introDuration,
        fps: recordFps
      };

      // 1. Initialize page
      await win.webContents.executeJavaScript(
        `window.initPage(${JSON.stringify(renderConfig)})`
      ).catch(err => console.error('[Record Job] initPage error:', err));

      // 2. Wait for fonts to be ready
      await win.webContents.executeJavaScript('document.fonts.ready');
      console.log('[Record Job] Page initialized and fonts are ready. Waiting 1000ms for GPU texture allocation...');

      // 3. Add a 1000ms delay to allow offscreen graphics buffer to initialize, avoiding UnknownVizError
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('[Record Job] GPU buffer allocated. Starting frame-by-frame rendering...');

      // 3. Resolve output path
      let outDir = config.outputDir;
      if (!outDir || !path.isAbsolute(outDir)) {
        outDir = path.join(projectDir, '..', 'out');
        console.warn(`[Record Job] outputDir fallback: ${outDir}`);
      }
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const safeDeptName = (config.departmentName || 'video')
        .replace(/[^a-zA-Z0-9 ıIğGüşŞöÖçÇ]/g, '').trim();
      const fileExt = isTransparent ? 'webm' : 'mp4';
      const outPath = path.join(outDir, `graduation_${safeDeptName}.${fileExt}`);
      console.log(`[Record Job] Output: ${outPath}`);

      // 4. Setup FFmpeg Spawn Arguments
      const ffmpegArgs = isTransparent
        ? [
            '-f', 'image2pipe', '-vcodec', 'mjpeg',
            '-framerate', String(recordFps),
            '-i', 'pipe:0',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v', 'libvpx-vp9',
            '-auto-alt-ref', '0',
            '-pix_fmt', 'yuva420p',
            '-y', outPath
          ]
        : [
            '-f', 'image2pipe', '-vcodec', 'mjpeg',
            '-framerate', String(recordFps),
            '-i', 'pipe:0',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '18',
            '-pix_fmt', 'yuv420p',
            '-y', outPath
          ];

      const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

      let ffmpegDead = false;
      ffmpegProcess.on('exit', (code) => {
        ffmpegDead = true;
        const exists = fs.existsSync(outPath);
        console.log(`[Record Job] FFmpeg exit: ${code} | exists: ${exists} | ${outPath}`);
        app.quit();
      });

      ffmpegProcess.stderr.on('data', d => {
        const msg = d.toString().trim();
        if (msg.startsWith('frame=') || /error/i.test(msg)) {
          console.log(`[FFmpeg] ${msg}`);
        }
      });

      ffmpegProcess.on('error', err => {
        console.error(`[Record Job] FFmpeg spawn error: ${err.message}`);
      });

      ffmpegProcess.stdin.on('error', err => {
        console.error(`[Record Job] FFmpeg stdin error: ${err.message}`);
      });

      // 5. Run Render Loop Frame-by-Frame (Deterministic Pull Model)
      let lastLogPct = -1;

      for (let frame = 0; frame < totalFrames; frame++) {
        if (ffmpegDead) {
          console.error('[Record Job] FFmpeg process died prematurely.');
          break;
        }

        // Seek renderer to exactly the offset for this frame
        await win.webContents.executeJavaScript(`window.seekToFrame(${frame})`);

        // Wait for Chromium to commit the frame to the compositor.
        // requestAnimationFrame does NOT fire when the window is off-screen (x: -20000),
        // causing the loop to hang. We use a layout flush and setTimeout instead.
        await win.webContents.executeJavaScript(`
          new Promise(resolve => {
            document.body.offsetHeight; // force layout calculation
            setTimeout(resolve, 15);     // yield to event loop for paint
          })
        `);

        // Capture page (GPU backbuffer readback)
        const image = await win.webContents.capturePage();
        
        // Convert to JPEG buffer (high speed, hardware-accelerated)
        const jpegBuf = image.toJPEG(90);

        // Write to stdin and wait for buffer drain
        await new Promise((resolve) => {
          if (ffmpegProcess.stdin.writable && !ffmpegDead) {
            ffmpegProcess.stdin.write(jpegBuf, () => resolve());
          } else {
            resolve();
          }
        });

        // Log progress
        const pct = Math.round((frame / totalFrames) * 100);
        if (pct !== lastLogPct && pct % 5 === 0) {
          lastLogPct = pct;
          console.log(`İlerleme: %${pct}`);
        }
      }

      console.log('[Record Job] All frames processed. Finalizing video...');
      if (!ffmpegDead) {
        try { ffmpegProcess.stdin.end(); } catch (e) {}
      }
    });
  });

} else {
  // ─────────────────────────────────────────────────────────────
  // NORMAL MODE: standard UI window + server.js
  // ─────────────────────────────────────────────────────────────
  let mainWindow = null;

  function startServer() {
    try {
      require('./server.js');
      console.log('Server started successfully inside Electron main process.');
    } catch (err) {
      console.error('Failed to start server:', err);
    }
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      title: 'Medipol Mezuniyet Videosu Olusturucu',
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    mainWindow.loadURL('http://localhost:4000');
    mainWindow.on('closed', () => { mainWindow = null; });
  }

  app.whenReady().then(() => {
    startServer();
    setTimeout(createWindow, 2000);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
