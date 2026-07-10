const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const EventEmitter = require('events');

const cpuCount = os.cpus().length;
const totalRamGb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
console.log(`[System Info] Detected ${cpuCount} CPUs, ${totalRamGb} GB RAM.`);

const app = express();
const port = 4000;

app.use(express.json()); // JSON parsing middleware

const renderEmitter = new EventEmitter();

// In-memory queue
const jobQueue = [];
let isProcessing = false;
let currentProcess = null; // Track running process

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Serve UI
app.use(express.static(path.join(__dirname, 'bot-ui')));

// Multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Folder Browser Endpoint: Cross-platform using native Electron dialog or PowerShell fallback
app.get('/api/browse-folder', (req, res) => {
  try {
    const { dialog } = require('electron');
    if (dialog && typeof dialog.showOpenDialogSync === 'function') {
      const result = dialog.showOpenDialogSync({
        properties: ['openDirectory'],
        title: 'Lütfen videoların kaydedileceği klasörü seçin'
      });
      if (result && result.length > 0) {
        return res.json({ folderPath: result[0] });
      } else {
        return res.status(500).json({ error: 'Klasör seçimi iptal edildi.' });
      }
    }
  } catch (err) {
    // Not running inside Electron main process (standalone node environment fallback)
  }

  // Windows PowerShell Fallback
  if (process.platform === 'win32') {
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      $FolderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
      $FolderBrowser.Description = "Lütfen videoların kaydedileceği klasörü seçin"
      $Show = $FolderBrowser.ShowDialog()
      if ($Show -eq "OK") {
        $FolderBrowser.SelectedPath
      }
    `;
    const proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { shell: false });
    let selectedPath = '';
    
    proc.stdout.on('data', (data) => {
      selectedPath += data.toString();
    });
    
    proc.on('close', (code) => {
      selectedPath = selectedPath.trim();
      if (code === 0 && selectedPath) {
        res.json({ folderPath: selectedPath });
      } else {
        res.status(500).json({ error: 'Klasör seçimi iptal edildi.' });
      }
    });
  } else {
    res.status(500).json({ error: 'Bu işletim sisteminde otomatik klasör seçimi desteklenmiyor. Lütfen yolu elle yazın.' });
  }
});

app.post('/api/generate', upload.single('background'), (req, res) => {
  const { 
    departmentName, 
    namesList, 
    format, 
    fps, 
    font, 
    textColor,
    fontWeight,
    fontSize,
    letterSpacing,
    nameHeight,
    wrapNames,
    autoShrink,
    caseMode,
    outputDir, 
    speed,
    aspectRatio,
    maskTopPercent,
    maskBottomPercent
  } = req.body;
  
  if (!departmentName || !namesList) {
    return res.status(400).json({ error: 'Bölüm adı ve isim listesi gereklidir.' });
  }

  // Calculate resolution from aspect ratio
  let width = 1920;
  let height = 1080;
  if (aspectRatio === '9:16') {
    width = 1080;
    height = 1920;
  } else if (aspectRatio === '4:3') {
    width = 1440;
    height = 1080;
  } else if (aspectRatio === '1:1') {
    width = 1080;
    height = 1080;
  }

  const jobId = Date.now().toString();
  
  const newJob = {
    id: jobId,
    departmentName,
    namesList,
    format,
    fps: parseInt(fps) || 60,
    font: font || "'Optima Nova LT Pro', 'Optima LT Pro', Optima, Candara, Calibri, sans-serif",
    textColor: textColor || '#ffffff',
    fontWeight: fontWeight || 'normal',
    fontSize: parseInt(fontSize) || 80,
    letterSpacing: parseFloat(letterSpacing) || 1.5,
    nameHeight: parseInt(nameHeight) || 160,
    wrapNames: wrapNames === 'true' || wrapNames === true,
    autoShrink: autoShrink === 'true' || autoShrink === true,
    caseMode: caseMode || 'uppercase',
    speed: parseFloat(speed) || 1.5,
    width,
    height,
    maskTopPercent: parseInt(maskTopPercent) !== undefined ? parseInt(maskTopPercent) : 20,
    maskBottomPercent: parseInt(maskBottomPercent) !== undefined ? parseInt(maskBottomPercent) : 80,
    outputDir: outputDir ? outputDir.trim() : 'out',
    imagePath: req.file ? req.file.path : null,
    status: 'pending', // pending, processing, completed, error
    progress: 0,
    log: ''
  };

  jobQueue.push(newJob);
  broadcastQueue();

  res.json({ message: 'Kuyruğa eklendi', jobId });

  // Trigger processor if idle
  if (!isProcessing) {
    processNextJob();
  }
});

// Cancel Job Endpoint
app.post('/api/cancel-job', (req, res) => {
  const { jobId } = req.body;
  if (!jobId) {
    return res.status(400).json({ error: 'Job ID gereklidir.' });
  }

  const jobIndex = jobQueue.findIndex(j => j.id === jobId);
  if (jobIndex === -1) {
    return res.status(404).json({ error: 'İşlem bulunamadı.' });
  }

  const job = jobQueue[jobIndex];

  if (job.status === 'pending') {
    // Delete custom uploaded template if present to free disk space
    if (job.imagePath) {
      try { fs.unlinkSync(job.imagePath); } catch (e) {}
    }
    // Simply remove from queue
    jobQueue.splice(jobIndex, 1);
    broadcastQueue();
    return res.json({ message: 'Bekleyen işlem kuyruktan kaldırıldı.' });
  }

  if (job.status === 'processing') {
    job.status = 'cancelled';
    if (currentProcess) {
      try {
        // Force kill process tree on Windows
        spawn('taskkill', ['/f', '/t', '/pid', currentProcess.pid], { shell: false });
      } catch (err) {
        console.error('Taskkill failed, running direct fallback kill:', err);
        try {
          currentProcess.kill();
        } catch (e) {}
      }
    }
    broadcastQueue();
    return res.json({ message: 'İşlem iptal ediliyor...' });
  }

  // Clear completed/error from dashboard history list
  if (job.imagePath) {
    try { fs.unlinkSync(job.imagePath); } catch (e) {}
  }
  jobQueue.splice(jobIndex, 1);
  broadcastQueue();
  return res.json({ message: 'İşlem geçmişten kaldırıldı.' });
});

// Queue broadcasting
function broadcastQueue() {
  renderEmitter.emit('queue', jobQueue.map(j => ({
    id: j.id,
    departmentName: j.departmentName,
    status: j.status,
    progress: j.progress
  })));
}

async function processNextJob() {
  if (jobQueue.length === 0) {
    isProcessing = false;
    return;
  }

  const jobIndex = jobQueue.findIndex(j => j.status === 'pending');
  if (jobIndex === -1) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const job = jobQueue[jobIndex];
  job.status = 'processing';
  broadcastQueue();

  renderEmitter.emit('log', `--- [KUYRUK] İŞLEM BAŞLADI: ${job.departmentName} ---`);

  try {
    // 1. Prepare Output Directory
    let parentPath = '..';
    if (__dirname.includes('resources') || __dirname.includes('app.asar')) {
      parentPath = path.join('..', '..');
    }
    const absoluteOutDir = path.isAbsolute(job.outputDir) 
      ? job.outputDir 
      : path.join(__dirname, parentPath, job.outputDir);
      
    if (!fs.existsSync(absoluteOutDir)) {
      fs.mkdirSync(absoluteOutDir, { recursive: true });
    }

    // 2. Prepare files for this specific job
    const namesPath = path.join(__dirname, 'isimler.txt');
    fs.writeFileSync(namesPath, job.namesList, 'utf8');

    // Prepare Config for Remotion
    const configPath = path.join(__dirname, 'src', 'config.json');
    const configObj = { 
      names: job.namesList.split('\n').map(n => n.trim()).filter(n => n),
      fps: job.fps, 
      fontFamily: job.font, 
      textColor: job.textColor,
      fontWeight: job.fontWeight,
      fontSize: job.fontSize,
      letterSpacing: job.letterSpacing,
      nameHeight: job.nameHeight,
      wrapNames: job.wrapNames,
      autoShrink: job.autoShrink,
      caseMode: job.caseMode,
      scrollSpeed: job.speed,
      width: job.width,
      height: job.height,
      maskTopPercent: job.maskTopPercent,
      maskBottomPercent: job.maskBottomPercent,
      format: job.format,
      outputDir: absoluteOutDir,
      departmentName: job.departmentName
    };
    fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2), 'utf8');

    // 3. Prepare Background Image
    const targetBgPath = path.join(__dirname, 'public', 'sablon.jpg');
    if (job.imagePath) {
      try {
        fs.copyFileSync(job.imagePath, targetBgPath);
        // Delete original uploads file immediately to save disk space
        fs.unlinkSync(job.imagePath);
        job.imagePath = null;
      } catch (imgErr) {
        console.error('Resim kopyalama veya silme hatası:', imgErr);
      }
    }

    // Determine output file
    const safeDeptName = job.departmentName.replace(/[^a-zA-Z0-9 ıIğGüşŞöÖçÇ]/g, '').trim();

    // Run Pre-render to populate names.json and lineCache.json
    renderEmitter.emit('log', `[Pre-render] çalıştırılıyor...`);
    await runCommand(process.execPath, [path.join(__dirname, 'pre-render.js')], (data) => renderEmitter.emit('log', data));

    renderEmitter.emit('log', `[Pre-render] tamamlandı. Kayıt işlemi başlatılıyor...`);

    // Determine path to Electron executable
    // In packaged app: __dirname is inside resources/app/ → go up two levels to find the .exe
    // In dev mode: use local electron binary
    let electronPath = null;
    let spawnArgs = ['--record'];

    if (__dirname.includes('resources') || __dirname.includes('app.asar')) {
      // Packaged: e.g. resources/app/server.js → ../../Medipol Video Bot.exe
      electronPath = path.join(__dirname, '..', '..', 'Medipol Video Bot.exe');
    } else {
      // Dev mode: use bundled electron binary
      const localElectron = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
      if (fs.existsSync(localElectron)) {
        electronPath = localElectron;
        // Dev electron needs the app path as first arg
        spawnArgs = [__dirname, '--record'];
      } else {
        // Last resort fallback
        electronPath = 'npx';
        spawnArgs = ['electron', __dirname, '--record'];
      }
    }

    console.log(`[server] Spawning Electron: ${electronPath} ${spawnArgs.join(' ')}`);

    // Run the record-job via --record flag
    let recordSuccess = false;
    await runCommand(electronPath, spawnArgs, (data) => {
      renderEmitter.emit('log', data);
      // Parse progress: "İlerleme: %X"
      const matchPct = data.match(/İlerleme:\s*%(\d+)/);
      if (matchPct) {
        const pct = parseInt(matchPct[1], 10);
        job.progress = pct;
        broadcastQueue();
      }
      // Detect successful FFmpeg output from record-job log
      if (data.includes('FFmpeg exit: 0')) {
        recordSuccess = true;
      }
    }).catch(() => {
      // Electron process may exit non-zero on crash; we handle below
    });

    // Verify the output file was actually created
    const fileExt = job.format === 'transparent' ? 'webm' : 'mp4';
    const outputFilename = `graduation_${safeDeptName}.${fileExt}`;
    const outputFullPath = path.join(absoluteOutDir, outputFilename);

    if (!fs.existsSync(outputFullPath)) {
      throw new Error(`Video dosyası oluşturulamadı. FFmpeg hatası — loglara bakın.`);
    }

    job.status = 'completed';
    job.progress = 100;
    renderEmitter.emit('log', `BAŞARILI: Video hazır! Dosya: ${outputFullPath}`);
    broadcastQueue();

  } catch (err) {
    if (job.status === 'cancelled') {
      renderEmitter.emit('log', `İPTAL EDİLDİ: İşlem kullanıcı tarafından iptal edildi.`);
    } else {
      job.status = 'error';
      renderEmitter.emit('log', `HATA: İşlem başarısız oldu - ${err.message}`);
    }
    broadcastQueue();
  }

  // Next job
  processNextJob();
}

// Targeted cleanup for orphaned headless browser processes
function cleanupHeadlessProcesses() {
  const psScript = `Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' or Name = 'chromium.exe' or Name = 'headless_shell.exe'" | Where-Object { $_.CommandLine -like "*headless*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
  spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { shell: false });
}

function runCommand(cmd, args, onData) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: __dirname, shell: false });
    currentProcess = proc;
    
    proc.stdout.on('data', d => onData(d.toString()));
    proc.stderr.on('data', d => onData(d.toString()));

    proc.on('close', code => {
      currentProcess = null;
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

// SSE Endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial queue state
  res.write(`data: ${JSON.stringify({ queue: jobQueue })}\n\n`);

  const queueListener = (q) => res.write(`data: ${JSON.stringify({ queue: q })}\n\n`);
  const logListener = (msg) => res.write(`data: ${JSON.stringify({ log: msg })}\n\n`);

  renderEmitter.on('queue', queueListener);
  renderEmitter.on('log', logListener);

  req.on('close', () => {
    renderEmitter.removeListener('queue', queueListener);
    renderEmitter.removeListener('log', logListener);
  });
});

app.listen(port, () => {
  console.log(`Bot Server running at http://localhost:${port}`);
});
