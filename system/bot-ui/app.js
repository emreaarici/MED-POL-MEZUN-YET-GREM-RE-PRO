document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('renderForm');
  const fileInput = document.getElementById('background');
  const fileMsg = document.querySelector('.file-msg');
  const fileDropArea = document.querySelector('.file-drop-area');
  const submitBtn = document.getElementById('submitBtn');
  const btnText = document.querySelector('.btn-text');
  const loader = document.querySelector('.loader');
  
  const logContainer = document.getElementById('logContainer');
  const logsDiv = document.getElementById('logs');
  const queueList = document.getElementById('queueList');
  
  // Folder selector
  const outputDirInput = document.getElementById('outputDir');
  const browseFolderBtn = document.getElementById('browseFolderBtn');
  
  // Sliders and controls
  const formatSelect = document.getElementById('format');
  const aspectRatioSelect = document.getElementById('aspectRatio');
  const fontSelect = document.getElementById('font');
  const textColorInput = document.getElementById('textColor');
  const fontWeightSelect = document.getElementById('fontWeight');
  const caseModeSelect = document.getElementById('caseMode');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  
  const fontSizeInput = document.getElementById('fontSize');
  const fontSizeVal = document.getElementById('fontSizeVal');
  const letterSpacingInput = document.getElementById('letterSpacing');
  const letterSpacingVal = document.getElementById('letterSpacingVal');
  const nameHeightInput = document.getElementById('nameHeight');
  const nameHeightVal = document.getElementById('nameHeightVal');
  const speedInput = document.getElementById('speed');
  const speedVal = document.getElementById('speedVal');
  
  const wrapNamesInput = document.getElementById('wrapNames');
  const autoShrinkInput = document.getElementById('autoShrink');
  const autoShrinkContainer = document.getElementById('autoShrinkContainer');
  
  const maskTopInput = document.getElementById('maskTopPercent');
  const maskBottomInput = document.getElementById('maskBottomPercent');
  
  // Interactive Preview Elements
  const videoPreview = document.getElementById('videoPreview');
  const previewBgImage = document.getElementById('previewBgImage');
  const dragLineTop = document.getElementById('dragLineTop');
  const dragLineBottom = document.getElementById('dragLineBottom');
  const maskVisual = document.getElementById('maskVisual');
  const previewListContainer = document.getElementById('previewListContainer');
  const previewScrollList = document.getElementById('previewScrollList');
  const restartPreviewBtn = document.getElementById('restartPreviewBtn');
  const namesListInput = document.getElementById('namesList');

  // Connect to SSE stream immediately to watch the queue
  let eventSource = null;
  startStream();

  // 1. Folder Browser trigger
  browseFolderBtn.addEventListener('click', async () => {
    browseFolderBtn.disabled = true;
    browseFolderBtn.textContent = 'Seçiliyor...';
    try {
      const response = await fetch('/api/browse-folder');
      if (response.ok) {
        const data = await response.json();
        if (data.folderPath) {
          outputDirInput.value = data.folderPath;
        }
      }
    } catch (err) {
      console.error('Klasör seçilemedi:', err);
    } finally {
      browseFolderBtn.disabled = false;
      browseFolderBtn.textContent = 'Seç...';
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      fileMsg.textContent = file.name;
      fileDropArea.style.borderColor = 'var(--primary-light)';
      
      // Load image into live preview background
      const reader = new FileReader();
      reader.onload = (event) => {
        if (previewBgImage) {
          previewBgImage.src = event.target.result;
          previewBgImage.style.display = 'block';
        }
      };
      reader.readAsDataURL(file);
    } else {
      fileMsg.textContent = 'Sürükleyip bırakın veya görsel seçin';
      fileDropArea.style.borderColor = 'var(--panel-border)';
      if (previewBgImage) {
        previewBgImage.src = '';
        previewBgImage.style.display = 'none';
      }
    }
  });

  // Explicit click listener to trigger file chooser dialog programmatically
  fileDropArea.addEventListener('click', (e) => {
    if (e.target !== fileInput) {
      fileInput.click();
    }
  });

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    fileDropArea.addEventListener(eventName, preventDefaults, false);
  });
  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
  ['dragenter', 'dragover'].forEach(eventName => { fileDropArea.addEventListener(eventName, () => fileDropArea.classList.add('active'), false); });
  
  // Handle drag-and-dropped file
  fileDropArea.addEventListener('drop', (e) => {
    fileDropArea.classList.remove('active');
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      fileInput.files = files;
      // Trigger change event to load image
      const changeEvent = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(changeEvent);
    }
  }, false);

  fileDropArea.addEventListener('dragleave', () => fileDropArea.classList.remove('active'), false);

  // 3. Aspect Ratio dropdown change updates preview box aspect
  aspectRatioSelect.addEventListener('change', (e) => {
    videoPreview.className = 'video-preview'; // Reset classes
    if (e.target.value === '16:9') {
      videoPreview.classList.add('ratio-16-9');
    } else if (e.target.value === '9:16') {
      videoPreview.classList.add('ratio-9-16');
    } else if (e.target.value === '4:3') {
      videoPreview.classList.add('ratio-4-3');
    } else if (e.target.value === '1:1') {
      videoPreview.classList.add('ratio-1-1');
    }
    // Update preview names calculations
    updateLivePreview();
  });

  // Format mode changes (disable upload for transparent WEBM)
  formatSelect.addEventListener('change', (e) => {
    if (e.target.value === 'transparent') {
      fileDropArea.style.opacity = '0.4';
      fileDropArea.style.pointerEvents = 'none';
      videoPreview.style.backgroundColor = 'transparent';
      if (previewBgImage) {
        previewBgImage.src = '';
        previewBgImage.style.display = 'none';
      }
    } else {
      fileDropArea.style.opacity = '1';
      fileDropArea.style.pointerEvents = 'auto';
      videoPreview.style.backgroundColor = '#000814';
      if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
          if (previewBgImage) {
            previewBgImage.src = event.target.result;
            previewBgImage.style.display = 'block';
          }
        };
        reader.readAsDataURL(file);
      }
    }
  });

  // 4. Draggable Boundary Lines Logic
  let isDraggingTop = false;
  let isDraggingBottom = false;

  dragLineTop.addEventListener('mousedown', (e) => { e.preventDefault(); isDraggingTop = true; });
  dragLineBottom.addEventListener('mousedown', (e) => { e.preventDefault(); isDraggingBottom = true; });

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingTop && !isDraggingBottom) return;

    const rect = videoPreview.getBoundingClientRect();
    let percentage = ((e.clientY - rect.top) / rect.height) * 100;
    percentage = Math.max(0, Math.min(100, percentage));

    if (isDraggingTop) {
      const bottomLimit = parseFloat(maskBottomInput.value);
      if (percentage < bottomLimit - 5) {
        maskTopInput.value = Math.round(percentage);
        dragLineTop.style.top = `${percentage}%`;
      }
    } else if (isDraggingBottom) {
      const topLimit = parseFloat(maskTopInput.value);
      if (percentage > topLimit + 5) {
        maskBottomInput.value = Math.round(percentage);
        dragLineBottom.style.top = `${percentage}%`;
      }
    }

    updateMaskVisuals();
  });

  window.addEventListener('mouseup', () => {
    isDraggingTop = false;
    isDraggingBottom = false;
  });

  // Also support touch for mobile/trackpads
  dragLineTop.addEventListener('touchstart', (e) => { isDraggingTop = true; });
  dragLineBottom.addEventListener('touchstart', (e) => { isDraggingBottom = true; });
  window.addEventListener('touchmove', (e) => {
    if (!isDraggingTop && !isDraggingBottom || e.touches.length === 0) return;
    const rect = videoPreview.getBoundingClientRect();
    let percentage = ((e.touches[0].clientY - rect.top) / rect.height) * 100;
    percentage = Math.max(0, Math.min(100, percentage));
    if (isDraggingTop) {
      const bottomLimit = parseFloat(maskBottomInput.value);
      if (percentage < bottomLimit - 5) {
        maskTopInput.value = Math.round(percentage);
        dragLineTop.style.top = `${percentage}%`;
      }
    } else if (isDraggingBottom) {
      const topLimit = parseFloat(maskTopInput.value);
      if (percentage > topLimit + 5) {
        maskBottomInput.value = Math.round(percentage);
        dragLineBottom.style.top = `${percentage}%`;
      }
    }
    updateMaskVisuals();
  });
  window.addEventListener('touchend', () => { isDraggingTop = false; isDraggingBottom = false; });

  function updateMaskVisuals() {
    const maskTop = parseFloat(maskTopInput.value);
    const maskBottom = parseFloat(maskBottomInput.value);

    // Update dashed visual overlay area
    maskVisual.style.top = `${maskTop}%`;
    maskVisual.style.height = `${maskBottom - maskTop}%`;

    // Apply real CSS mask to the scrolling list container
    const maskCss = `linear-gradient(to bottom, transparent 0%, transparent ${maskTop}%, black ${Math.min(maskTop + 5, maskBottom)}%, black ${Math.max(maskBottom - 5, maskTop)}%, transparent ${maskBottom}%, transparent 100%)`;
    previewListContainer.style.maskImage = maskCss;
    previewListContainer.style.webkitMaskImage = maskCss;
  }

  // 5. Update Slider labels and trigger preview updates
  fontSizeInput.addEventListener('input', (e) => { fontSizeVal.textContent = `${e.target.value}px`; updateLivePreview(); });
  letterSpacingInput.addEventListener('input', (e) => { letterSpacingVal.textContent = `${e.target.value}px`; updateLivePreview(); });
  nameHeightInput.addEventListener('input', (e) => { nameHeightVal.textContent = `${e.target.value}px`; updateLivePreview(); });
  speedInput.addEventListener('input', (e) => { speedVal.textContent = `${e.target.value}`; updateLivePreview(); });
  
  fontSelect.addEventListener('change', updateLivePreview);
  textColorInput.addEventListener('input', updateLivePreview);
  fontWeightSelect.addEventListener('change', updateLivePreview);
  caseModeSelect.addEventListener('change', updateLivePreview);
  clearLogsBtn.addEventListener('click', () => {
    logsDiv.innerHTML = '';
  });
  
  wrapNamesInput.addEventListener('change', () => {
    if (wrapNamesInput.checked) {
      autoShrinkInput.checked = false;
      autoShrinkContainer.style.opacity = '0.4';
      autoShrinkContainer.style.pointerEvents = 'none';
    } else {
      autoShrinkContainer.style.opacity = '1';
      autoShrinkContainer.style.pointerEvents = 'auto';
    }
    updateLivePreview();
  });
  autoShrinkInput.addEventListener('change', updateLivePreview);
  namesListInput.addEventListener('input', updateLivePreview);
  restartPreviewBtn.addEventListener('click', restartPreviewAnimation);

  // 6. Generate Live scrolling names preview list dynamically
  function updateLivePreview() {
    // Read parameters
    const namesText = namesListInput.value.trim();
    const names = namesText ? namesText.split('\n').map(n => n.trim()).filter(n => n) : ['ÖRNEK İSİM 1', 'ÖRNEK İSİM 2', 'ÖRNEK İSİM 3'];

    const fontFamily = fontSelect.value;
    const textColor = textColorInput.value;
    const fontWeight = fontWeightSelect.value;
    const caseMode = caseModeSelect.value;
    const baseFontSize = parseInt(fontSizeInput.value);
    const letterSpacing = `${letterSpacingInput.value}px`;
    const nameHeight = parseInt(nameHeightInput.value);
    const speed = parseFloat(speedInput.value);

    // Clear previous items
    previewScrollList.innerHTML = '';
    
    // Scale factor depending on the display size of preview box (approximate)
    const previewScale = videoPreview.clientWidth / 1920; 

    // Build scrolling DOM elements
    names.forEach(name => {
      const displayName = caseMode === 'original' ? name : name.toUpperCase();
      let size = baseFontSize;
      let whiteSpace = 'nowrap';
      let wordBreak = 'normal';

      if (wrapNamesInput.checked) {
        whiteSpace = 'normal';
        wordBreak = 'break-word';
      } else if (autoShrinkInput.checked) {
        // Auto shrink formula for preview
        const maxChars = Math.floor(videoPreview.clientWidth / (baseFontSize * 0.45));
        if (displayName.length > maxChars) {
          const shrinkFactor = maxChars / displayName.length;
          size = Math.max(20, Math.floor(baseFontSize * shrinkFactor));
        }
      }

      const div = document.createElement('div');
      div.textContent = displayName;
      div.style.fontFamily = fontFamily;
      div.style.fontSize = `${size * previewScale}px`;
      div.style.fontWeight = fontWeight;
      div.style.color = textColor;
      div.style.minHeight = `${nameHeight * previewScale}px`;
      div.style.height = 'auto';
      div.style.padding = `${15 * previewScale}px 0`;
      div.style.lineHeight = '1.15';
      div.style.letterSpacing = `${parseFloat(letterSpacingInput.value) * previewScale}px`;
      div.style.whiteSpace = whiteSpace;
      div.style.wordBreak = wordBreak;
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.justifyContent = 'center';
      div.style.textAlign = 'center';
      div.style.maxWidth = '90%';
      div.style.overflow = 'hidden';
      div.style.textOverflow = wrapNamesInput.checked || autoShrinkInput.checked ? 'clip' : 'ellipsis';

      previewScrollList.appendChild(div);
    });

    // Calculate exact rendered dimensions to synchronize preview speed with the actual video
    const previewListHeight = previewScrollList.scrollHeight || (names.length * nameHeight * previewScale);
    const containerHeight = videoPreview.clientHeight || 240;

    // Set dynamic start/end coordinates for the CSS keyframes
    previewScrollList.style.setProperty('--start-y', `${containerHeight}px`);
    previewScrollList.style.setProperty('--end-y', `${-previewListHeight}px`);

    // Travel distance = containerHeight + listHeight
    const totalTravelDistance = containerHeight + previewListHeight;
    // speed is px/frame. At 60 FPS, speed is speed * 60 px/sec. Scaled down by previewScale.
    const pixelsPerSecond = speed * 60 * previewScale;
    const duration = Math.max(3, totalTravelDistance / pixelsPerSecond);

    previewScrollList.style.animationName = 'none';
    void previewScrollList.offsetHeight;
    previewScrollList.style.animationName = 'previewScroll';
    previewScrollList.style.animationDuration = `${duration}s`;
    previewScrollList.style.animationTimingFunction = 'linear';
    previewScrollList.style.animationIterationCount = 'infinite';

    // Update visuals
    updateMaskVisuals();
  }

  function restartPreviewAnimation() {
    previewScrollList.style.animationName = 'none';
    void previewScrollList.offsetHeight;
    previewScrollList.style.animationName = 'previewScroll';
  }

  // 7. Form Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(form);
    
    // Explicitly add wrapNames and autoShrink checkboxes (FormData doesn't add unchecked inputs)
    formData.set('wrapNames', wrapNamesInput.checked);
    formData.set('autoShrink', autoShrinkInput.checked);

    // Validation: If template format is selected, background file is mandatory
    if (formatSelect.value === 'template' && (!fileInput.files || fileInput.files.length === 0)) {
      alert('HATA: Şablonlu MP4 modunda render alabilmek için lütfen bir arka plan görseli (sablon.jpg) yükleyin.');
      return;
    }

    submitBtn.disabled = true;
    btnText.textContent = 'Render Sırasına Alındı...';
    loader.style.display = 'block';

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Bir hata oluştu');
      }
      
      logContainer.style.display = 'block';

    } catch (err) {
      alert(`Hata: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      btnText.textContent = 'Kuyruğa Ekle ve Render Al';
      loader.style.display = 'none';
    }
  });

  function appendLog(text) {
    const p = document.createElement('div');
    p.textContent = text;
    logsDiv.appendChild(p);
    
    // Limit console output to the last 150 lines to prevent DOM inflation and UI freezing/lag
    while (logsDiv.children.length > 150) {
      logsDiv.removeChild(logsDiv.firstChild);
    }
    
    logsDiv.scrollTop = logsDiv.scrollHeight;
  }

  function startStream() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource('/api/stream');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.queue) {
        renderQueue(data.queue);
      }
      
      if (data.log) {
        if(logContainer.style.display === 'none') {
          logContainer.style.display = 'block';
        }
        appendLog(data.log);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE Error:', err);
      eventSource.close();
      setTimeout(startStream, 3000); // Reconnect loop
    };
  }

  // Handle cancel button clicks in queue
  queueList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.cancel-job-btn');
    if (!btn) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const jobId = btn.dataset.id;
    btn.disabled = true;
    
    try {
      const response = await fetch('/api/cancel-job', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ jobId })
      });
      
      if (!response.ok) {
        throw new Error('İptal işlemi başarısız.');
      }
    } catch (err) {
      alert(err.message);
    }
  });

  function renderQueue(queue) {
    if (!queue || queue.length === 0) {
      queueList.innerHTML = '<p class="empty-queue-msg">Şu an kuyrukta işlem yok.</p>';
      return;
    }

    queueList.innerHTML = '';
    queue.forEach(job => {
      const card = document.createElement('div');
      card.className = `queue-card status-${job.status}`;
      
      let statusText = 'Bekliyor';
      if (job.status === 'processing') statusText = 'İşleniyor';
      if (job.status === 'completed') statusText = 'Tamamlandı';
      if (job.status === 'error') statusText = 'Hata';
      if (job.status === 'cancelled') statusText = 'İptal Edildi';

      const isCancelable = job.status === 'processing' || job.status === 'pending';
      const buttonIcon = isCancelable ? '❌' : '🗑️';
      const buttonTitle = isCancelable ? 'İptal Et' : 'Geçmişten Kaldır';

      card.innerHTML = `
        <div class="queue-card-header">
          <strong>${job.departmentName}</strong>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="queue-badge ${job.status}">${statusText}</span>
            <button type="button" class="cancel-job-btn" data-id="${job.id}" title="${buttonTitle}">
              ${buttonIcon}
            </button>
          </div>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${job.progress}%"></div>
        </div>
        <div style="font-size: 0.8rem; text-align: right; margin-top: 5px; color: #ffd700;">
          %${job.progress}
        </div>
      `;
      queueList.appendChild(card);
    });
  }

  // Initialize preview on first load
  setTimeout(() => {
    updateLivePreview();
  }, 100);
});
