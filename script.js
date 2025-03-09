// Global debug object to store information
window.debugInfo = {
    browserInfo: navigator.userAgent,
    errors: [],
    events: []
};

// Helper: Append progress messages into the status div
function updateProgress(message) {
  const statusDiv = document.getElementById('status');
  const p = document.createElement('p');
  p.textContent = `${new Date().toISOString().substring(11, 19)} - ${message}`;
  statusDiv.appendChild(p);
  statusDiv.scrollTop = statusDiv.scrollHeight;
  
  // Also log to debug events
  window.debugInfo.events.push({
    time: new Date(),
    message: message
  });
}

// Helper: Append error messages into the status div
function updateError(message, error = null) {
  const statusDiv = document.getElementById('status');
  const p = document.createElement('p');
  p.style.color = 'red';
  p.textContent = `ERROR ${new Date().toISOString().substring(11, 19)} - ${message}`;
  
  if (error) {
    const details = document.createElement('pre');
    details.textContent = `Stack: ${error.stack || 'No stack trace available'}`;
    details.style.fontSize = '10px';
    details.style.marginTop = '5px';
    p.appendChild(details);
    
    // Store in debug info
    window.debugInfo.errors.push({
      time: new Date(),
      message: message,
      errorObj: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    });
  }
  
  statusDiv.appendChild(p);
  statusDiv.scrollTop = statusDiv.scrollHeight;
}

// Add unhandled error listeners
window.addEventListener('error', function(event) {
  updateError(`Unhandled error: ${event.message} at ${event.filename}:${event.lineno}`, event.error);
  showDebugSummary();
  return false;
});

window.addEventListener('unhandledrejection', function(event) {
  updateError(`Unhandled promise rejection: ${event.reason}`, event.reason);
  showDebugSummary();
  return false;
});

// Show device and browser information
function showDeviceInfo() {
  updateProgress(`Device Info: ${navigator.userAgent}`);
  updateProgress(`Screen size: ${window.screen.width}x${window.screen.height}`);
  updateProgress(`iOS? ${/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream}`);
  
  // Test basic browser capabilities
  updateProgress("Testing canvas support: " + (!!document.createElement('canvas').getContext));
  updateProgress("Testing MediaRecorder support: " + (typeof MediaRecorder !== 'undefined'));
  
  try {
    const testCanvas = document.createElement('canvas');
    testCanvas.width = 320;
    testCanvas.height = 240;
    const testStream = testCanvas.captureStream(30);
    updateProgress("Canvas captureStream successful");
  } catch (e) {
    updateError("Canvas captureStream failed", e);
  }
}

// Function to show a summary of all debug information
function showDebugSummary() {
  updateProgress("----------- DEBUG SUMMARY -----------");
  updateProgress(`Total events logged: ${window.debugInfo.events.length}`);
  updateProgress(`Total errors: ${window.debugInfo.errors.length}`);
  
  if (window.debugInfo.videoInfo) {
    updateProgress(`Video processing:
    - Files processed: ${window.debugInfo.videoInfo.filesProcessed}
    - Planned duration: ${window.debugInfo.videoInfo.plannedDuration}s
    - Actual duration: ${window.debugInfo.videoInfo.actualDuration}s
    - Frames drawn: ${window.debugInfo.videoInfo.framesDrawn}
    - Chunks recorded: ${window.debugInfo.videoInfo.chunksRecorded}
    - Recorder MIME: ${window.debugInfo.videoInfo.recorderMimeType}`);
  }
}

document.getElementById('start-button').addEventListener('click', async () => {
  try {
    // Reset debug info
    window.debugInfo = {
      browserInfo: navigator.userAgent,
      errors: [],
      events: [],
      videoInfo: {
        filesProcessed: 0,
        plannedDuration: 0,
        actualDuration: 0,
        framesDrawn: 0,
        chunksRecorded: 0,
        recorderMimeType: 'unknown'
      }
    };
    
    updateProgress('Start button clicked.');
    showDeviceInfo();
    
    const files = document.getElementById('video-files').files;
    const finalLength = parseInt(document.getElementById('final-length').value);
    const minClipLength = parseInt(document.getElementById('min-clip-length').value);
    const maxClipLength = parseInt(document.getElementById('max-clip-length').value);
    const zoomProbability = parseFloat(document.getElementById('zoom-probability').value);
    const minZoom = parseFloat(document.getElementById('min-zoom').value);
    const maxZoom = parseFloat(document.getElementById('max-zoom').value);
    const flipProbability = parseFloat(document.getElementById('flip-probability').value);
    
    // NEW: Get final canvas dimensions from the index.html file
    const finalWidth = parseInt(document.getElementById('final-width').value);
    const finalHeight = parseInt(document.getElementById('final-height').value);

    // Clear previous status messages and hide download button
    document.getElementById('status').innerHTML = '';
    document.getElementById('download-button').style.display = 'none';
    
    // Log initial settings
    updateProgress(`Settings: 
    - Final video length: ${finalLength}s
    - Clip length range: ${minClipLength}%-${maxClipLength}%
    - Canvas size: ${finalWidth}x${finalHeight}
    - Zoom: ${zoomProbability}% chance, ${minZoom}%-${maxZoom}% range
    - Flip: ${flipProbability}% chance`);
    
    window.debugInfo.videoInfo.plannedDuration = finalLength;

    if (!files.length) {
        updateError('Please select at least one video file.');
        return;
    }

    if (
        isNaN(finalLength) ||
        isNaN(minClipLength) ||
        isNaN(maxClipLength) ||
        minClipLength > maxClipLength ||
        isNaN(zoomProbability) ||
        isNaN(minZoom) ||
        isNaN(maxZoom) ||
        minZoom > maxZoom ||
        isNaN(finalWidth) ||
        isNaN(finalHeight) ||
        isNaN(flipProbability)
    ) {
        updateError('Please enter valid numeric values.');
        return;
    }

    updateProgress('Starting video editing process...');
    await processVideos(files, finalLength, minClipLength, maxClipLength, zoomProbability, minZoom, maxZoom, finalWidth, finalHeight, flipProbability);
    
    // Show summary at the end
    showDebugSummary();
  } catch (e) {
    updateError(`Main process error: ${e.message}`, e);
    showDebugSummary();
  }
});

async function processVideos(files, finalLength, minClipLength, maxClipLength, zoomProbability, minZoom, maxZoom, finalWidth, finalHeight, flipProbability) {
  try {
    updateProgress('Initializing processing...');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }
    
    updateProgress(`Created canvas: ${finalWidth}x${finalHeight}`);
    
    const chunks = [];

    // Set canvas dimensions from the provided inputs.
    canvas.width = finalWidth;
    canvas.height = finalHeight;

    // Use a captureStream frame rate of 30 FPS (can be adjusted)
    let stream;
    try {
      stream = canvas.captureStream(30);
      updateProgress('Successfully created canvas stream with 30fps');
    } catch (e) {
      updateError('Failed to create canvas stream', e);
      throw e;
    }

    // Try different mimeTypes for better iOS compatibility
    const possibleMimeTypes = [
      'video/mp4; codecs="avc1.42E01E"',
      'video/webm; codecs="vp8, opus"',
      'video/webm',
      'video/mp4'
    ];
    
    let recorder;
    let usedMimeType = 'default';
    let success = false;
    
    for (const mimeType of possibleMimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        updateProgress(`Testing supported MIME type: ${mimeType}`);
        try {
          recorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: 8000000
          });
          usedMimeType = mimeType;
          success = true;
          break;
        } catch (e) {
          updateError(`Failed with MIME type ${mimeType}`, e);
        }
      } else {
        updateProgress(`MIME type not supported: ${mimeType}`);
      }
    }
    
    // Fallback if none of the MIME types worked
    if (!success) {
      updateProgress('Using default MediaRecorder settings as all specific formats failed');
      try {
        recorder = new MediaRecorder(stream);
      } catch (e) {
        updateError('Failed to create MediaRecorder with default settings', e);
        throw e;
      }
    }
    
    window.debugInfo.videoInfo.recorderMimeType = usedMimeType;
    updateProgress(`MediaRecorder created with MIME type: ${usedMimeType}`);

    recorder.ondataavailable = (e) => {
      updateProgress(`Data available event: chunk size = ${e.data.size} bytes`);
      chunks.push(e.data);
      window.debugInfo.videoInfo.chunksRecorded++;
    };
    
    recorder.onerror = (e) => {
      updateError('MediaRecorder error', e);
    };
    
    recorder.onstop = () => {
      try {
        updateProgress(`Recording stopped. Creating blob from ${chunks.length} chunks`);
        const blob = new Blob(chunks, { type: recorder.mimeType });
        updateProgress(`Blob created: size=${(blob.size/1024/1024).toFixed(2)}MB, type=${blob.type}`);
        
        const videoURL = URL.createObjectURL(blob);
        updateProgress('URL object created for blob');
        
        const videoElement = document.getElementById('output-video');
        videoElement.src = videoURL;
        videoElement.onloadedmetadata = () => {
          updateProgress(`Output video loaded. Duration: ${videoElement.duration.toFixed(2)}s`);
          window.debugInfo.videoInfo.actualDuration = videoElement.duration;
        };
        videoElement.onerror = (e) => {
          updateError('Error loading output video', e);
        };
        
        updateProgress('Video processing completed.');

        // Show and configure the DOWNLOAD button
        const downloadBtn = document.getElementById('download-button');
        downloadBtn.style.display = 'block';
        downloadBtn.onclick = () => {
          try {
            updateProgress('Download button clicked');
            const a = document.createElement('a');
            a.href = videoURL;
            a.download = 'final_video.mp4';
            document.body.appendChild(a);
            updateProgress('Created download link');
            a.click();
            updateProgress('Click event dispatched on download link');
            document.body.removeChild(a);
            updateProgress('Download link removed from DOM');
          } catch (e) {
            updateError('Error during download', e);
          }
        };
      } catch (e) {
        updateError('Error in recorder.onstop handler', e);
      }
    };

    // Build randomized clip configurations until total duration meets or exceeds finalLength.
    let totalDuration = 0;
    let lastIndex = -1;
    const clipConfs = [];
    const filesArray = Array.from(files);
    updateProgress(`Building clip configurations for ${filesArray.length} files...`);
    window.debugInfo.videoInfo.filesProcessed = filesArray.length;
    
    while (totalDuration < finalLength) {
        let idx = Math.floor(Math.random() * filesArray.length);
        // If there is more than one file and the index matches last selected, choose the next index.
        if (filesArray.length > 1 && idx === lastIndex) {
            idx = (idx + 1) % filesArray.length;
        }
        lastIndex = idx;
        const randFile = filesArray[idx];
        updateProgress(`Getting duration for file: ${randFile.name}`);
        
        let duration;
        try {
          duration = await getVideoDuration(randFile);
          updateProgress(`Got duration for ${randFile.name}: ${duration.toFixed(2)}s`);
        } catch (e) {
          updateError(`Failed to get duration for ${randFile.name}`, e);
          continue; // Try the next file
        }
        
        const clipLength = getRandomClipLength(minClipLength, maxClipLength, duration);
        const startTime = getRandomStartTime(duration, clipLength);
        clipConfs.push({ file: randFile, startTime, clipLength });
        totalDuration += clipLength;
        updateProgress(`Added clip from ${randFile.name}: start=${startTime.toFixed(2)}s, length=${clipLength.toFixed(2)}s. Total planned duration: ${totalDuration.toFixed(2)}s`);
    }

    // Create 4 video elements for a larger preloading pipeline.
    const videoPlayers = [];
    updateProgress('Creating video player elements for preloading pipeline...');
    for (let i = 0; i < 4; i++) {
        const video = document.createElement('video');
        // Prevent full-screen on iPhone by enabling inline playback.
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.muted = true;
        video.autoplay = false; // Start as false, will be enabled when needed
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';
        videoPlayers.push(video);
        updateProgress(`Created video player ${i+1} with inline playback enabled`);
    }

    // Preload the first clip into slot 0.
    if (clipConfs.length === 0) {
        updateError('No clips to process.');
        return;
    }
    const firstClip = clipConfs.shift();
    updateProgress(`Preloading first clip from ${firstClip.file.name} (start: ${firstClip.startTime.toFixed(2)}s, length: ${firstClip.clipLength.toFixed(2)}s) into slot 0`);
    
    try {
      await preloadClip(videoPlayers[0], firstClip.file, firstClip.startTime, firstClip.clipLength);
      videoPlayers[0].clipConf = firstClip;
      updateProgress(`Successfully preloaded first clip from ${firstClip.file.name} into slot 0`);
    } catch (e) {
      updateError(`Failed to preload first clip from ${firstClip.file.name}`, e);
      throw e; // Critical error, can't continue
    }

    // Preload remaining clips into slots 1 to 3, if available.
    for (let i = 1; i < videoPlayers.length; i++) {
        if (clipConfs.length > 0) {
            const clip = clipConfs.shift();
            updateProgress(`Preloading clip from ${clip.file.name} (start: ${clip.startTime.toFixed(2)}s, length: ${clip.clipLength.toFixed(2)}s) into slot ${i}`);
            try {
              await preloadClip(videoPlayers[i], clip.file, clip.startTime, clip.clipLength);
              videoPlayers[i].clipConf = clip;
              updateProgress(`Successfully preloaded clip from ${clip.file.name} into slot ${i}`);
            } catch (e) {
              updateError(`Failed to preload clip from ${clip.file.name} into slot ${i}`, e);
              // Continue with the next clip
            }
        }
    }

    // Start recording and capture the recording start time.
    try {
      updateProgress('Starting MediaRecorder...');
      recorder.start(1000); // Request data every second for better reliability
      updateProgress('MediaRecorder started successfully');
    } catch (e) {
      updateError('Failed to start MediaRecorder', e);
      throw e;
    }
    
    const recordStartTime = performance.now();
    updateProgress('Recording started.');

    let currentPlayerIndex = 0;
    let previousClip = null;
    // Build zoomConfig including the new flipProbability.
    const zoomConfig = { zoomProbability, minZoom, maxZoom, flipProbability };
    let clipCounter = 0;

    // Continue playing clips while the overall elapsed time is less than finalLength.
    while (performance.now() - recordStartTime < finalLength * 1000) {
        clipCounter++;
        const currentPlayer = videoPlayers[currentPlayerIndex];
        
        if (!currentPlayer.clipConf) {
          updateProgress(`No clip configuration available for player index ${currentPlayerIndex}, breaking loop`);
          break;
        }
        
        const currentVideo = currentPlayer;
        const currentClip = currentPlayer.clipConf;
        
        updateProgress(`Processing clip ${clipCounter}: ${currentClip.file.name}, start=${currentClip.startTime.toFixed(2)}s, length=${currentClip.clipLength.toFixed(2)}s`);

        // Pass recordStartTime and finalLength so the clip stops drawing when time is up.
        try {
          const playPromise = playActiveClip(
              currentVideo,
              currentClip,
              canvas,
              ctx,
              zoomConfig,
              previousClip,
              recordStartTime,
              finalLength
          );

          // Preload next clip if available.
          if (clipConfs.length > 0) {
              const upcoming = clipConfs.shift();
              const nextIndex = (currentPlayerIndex + 1) % videoPlayers.length;
              updateProgress(`Preloading next clip from ${upcoming.file.name} into slot ${nextIndex}`);
              try {
                await preloadClip(
                    videoPlayers[nextIndex],
                    upcoming.file,
                    upcoming.startTime,
                    upcoming.clipLength
                );
                videoPlayers[nextIndex].clipConf = upcoming;
                updateProgress(`Successfully preloaded next clip from ${upcoming.file.name} into slot ${nextIndex}`);
              } catch (e) {
                updateError(`Failed to preload next clip from ${upcoming.file.name}`, e);
              }
          }
          
          await playPromise;
          updateProgress(`Completed playing clip ${clipCounter} from ${currentClip.file.name}`);
        } catch (e) {
          updateError(`Error playing clip ${clipCounter} from ${currentClip.file.name}`, e);
        }

        previousClip = { video: currentVideo, conf: currentClip };
        currentPlayerIndex = (currentPlayerIndex + 1) % videoPlayers.length;
    }

    // If playback ended early, wait until finalLength has elapsed.
    const elapsed = performance.now() - recordStartTime;
    if (elapsed < finalLength * 1000) {
        const remainingTime = finalLength * 1000 - elapsed;
        updateProgress(`Waiting for remaining ${(remainingTime/1000).toFixed(1)}s before stopping recording...`);
        await new Promise(resolve => setTimeout(resolve, remainingTime));
    }

    try {
      updateProgress('Stopping MediaRecorder...');
      recorder.stop();
      updateProgress('MediaRecorder stopped successfully');
    } catch (e) {
      updateError('Failed to stop MediaRecorder', e);
    }
    
  } catch (e) {
    updateError(`Video processing error: ${e.message}`, e);
    showDebugSummary();
  }
}

function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
      const tempVideo = document.createElement('video');
      
      // Set a timeout in case the video metadata never loads
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout getting duration for ${file.name}`));
      }, 10000);
      
      tempVideo.src = URL.createObjectURL(file);
      
      tempVideo.onloadedmetadata = () => {
          clearTimeout(timeoutId);
          resolve(tempVideo.duration);
      };
      
      tempVideo.onerror = (e) => {
          clearTimeout(timeoutId);
          reject(new Error(`Error loading video ${file.name}: ${tempVideo.error ? tempVideo.error.message : 'Unknown error'}`));
      };
  });
}

function getRandomClipLength(minClipLength, maxClipLength, duration) {
  const minLength = (minClipLength / 100) * duration;
  const maxLength = (maxClipLength / 100) * duration;
  return Math.random() * (maxLength - minLength) + minLength;
}

function getRandomStartTime(duration, clipLength) {
  return Math.random() * (duration - clipLength);
}

function preloadClip(video, file, startTime, clipLength) {
  return new Promise((resolve, reject) => {
      // Set a timeout in case the video never loads or seeks
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout preloading clip from ${file.name}`));
      }, 20000);
      
      try {
        video.src = URL.createObjectURL(file);
        
        video.onloadedmetadata = () => {
            try {
              if (startTime >= 0 && startTime < video.duration) {
                video.currentTime = startTime;
              } else {
                clearTimeout(timeoutId);
                reject(new Error(`Invalid start time ${startTime} for video of length ${video.duration}`));
              }
            } catch (e) {
              clearTimeout(timeoutId);
              reject(new Error(`Error setting currentTime: ${e.message}`));
            }
        };
        
        video.onseeked = () => {
            clearTimeout(timeoutId);
            resolve();
        };
        
        video.onerror = (e) => {
            clearTimeout(timeoutId);
            reject(new Error(`Error preloading video: ${video.error ? video.error.message : 'Unknown error'}`));
        };
      } catch (e) {
        clearTimeout(timeoutId);
        reject(e);
      }
  });
}

// Play a clip by drawing frames from the video onto the canvas.
// The drawFrame function stops drawing when the elapsed time reaches finalLength.
function playActiveClip(video, clipConf, canvas, ctx, zoomConfig, previousClip, recordStartTime, finalLength) {
  return new Promise((resolve, reject) => {
      const { startTime, clipLength, file } = clipConf;
      const clipEndTime = startTime + clipLength;
      const overlapDuration = 1.0; // 1 second overlap

      // Determine whether to apply zoom.
      let applyZoom = Math.random() < (zoomConfig.zoomProbability / 100);
      let zoomFactor = 1;
      let fixedOffsetX, fixedOffsetY, zoomedSW, zoomedSH;

      // Compute base crop rectangle based on canvas aspect ratio.
      const videoAspect = video.videoWidth / video.videoHeight;
      const canvasAspect = canvas.width / canvas.height;
      let baseSX, baseSY, baseSW, baseSH;
      
      updateProgress(`Video dimensions: ${video.videoWidth}x${video.videoHeight}, aspect: ${videoAspect.toFixed(2)}`);
      updateProgress(`Canvas dimensions: ${canvas.width}x${canvas.height}, aspect: ${canvasAspect.toFixed(2)}`);
      
      if (videoAspect > canvasAspect) {
          baseSH = video.videoHeight;
          baseSW = video.videoHeight * canvasAspect;
          baseSX = (video.videoWidth - baseSW) / 2;
          baseSY = 0;
      } else {
          baseSW = video.videoWidth;
          baseSH = video.videoWidth / canvasAspect;
          baseSY = (video.videoHeight - baseSH) / 2;
          baseSX = 0;
      }
      
      updateProgress(`Base crop rectangle: x=${baseSX.toFixed(0)}, y=${baseSY.toFixed(0)}, width=${baseSW.toFixed(0)}, height=${baseSH.toFixed(0)}`);
      
      if (applyZoom) {
          zoomFactor = Math.random() * ((zoomConfig.maxZoom - zoomConfig.minZoom) / 100) + (zoomConfig.minZoom / 100);
          zoomedSW = baseSW / zoomFactor;
          zoomedSH = baseSH / zoomFactor;
          const maxOffsetX = baseSW - zoomedSW;
          const maxOffsetY = baseSH - zoomedSH;
          fixedOffsetX = baseSX + Math.random() * maxOffsetX;
          fixedOffsetY = baseSY + Math.random() * maxOffsetY;
          updateProgress(`Applied zoom on ${file.name}: ${(zoomFactor * 100).toFixed(0)}%, crop at x:${fixedOffsetX.toFixed(0)}, y:${fixedOffsetY.toFixed(0)}, width:${zoomedSW.toFixed(0)}, height:${zoomedSH.toFixed(0)}`);
      }
      
      // Determine if the clip should be flipped horizontally.
      const flipClip = Math.random() < (zoomConfig.flipProbability / 100);
      if (flipClip) {
          updateProgress(`Applied horizontal flip on ${file.name}`);
      }
      
      let frameCount = 0;
      let errorOccurred = false;
      
      // Set a timeout in case the video never plays
      const timeoutId = setTimeout(() => {
        if (frameCount === 0) {
          errorOccurred = true;
          reject(new Error(`Timeout waiting for video playback to start for ${file.name}`));
        }
      }, 10000);
      
      video.autoplay = true;
      video.play().then(() => {
          updateProgress(`Video playback started for ${file.name} at time ${video.currentTime.toFixed(2)}s`);
          
          const drawFrame = () => {
              if (errorOccurred) return;
              
              frameCount++;
              window.debugInfo.videoInfo.framesDrawn++;
              
              // Check if we've reached the end of the recording time
              if (performance.now() - recordStartTime >= finalLength * 1000) {
                  clearTimeout(timeoutId);
                  updateProgress(`Reached final length (${finalLength}s), stopping clip playback`);
                  resolve();
                  return;
              }
              
              try {
                  ctx.clearRect(0, 0, canvas.width, canvas.height);
    
                  // Draw previous clip during the overlap period.
                  if (previousClip && video.currentTime < startTime + overlapDuration) {
                      try {
                        ctx.drawImage(previousClip.video, 0, 0, canvas.width, canvas.height);
                      } catch (e) {
                        updateError(`Error drawing previous clip frame: ${e.message}`);
                      }
                  }
                  
                  // If flipping is applied, flip the context before drawing.
                  if (flipClip) {
                      ctx.save();
                      ctx.translate(canvas.width, 0);
                      ctx.scale(-1, 1);
                  }
    
                  if (applyZoom) {
                      ctx.drawImage(video, fixedOffsetX, fixedOffsetY, zoomedSW, zoomedSH, 0, 0, canvas.width, canvas.height);
                  } else {
                      // Draw the full video frame.
                      ctx.drawImage(video, baseSX, baseSY, baseSW, baseSH, 0, 0, canvas.width, canvas.height);
                  }
                  
                  if (flipClip) {
                      ctx.restore();
                  }
                  
                  if (video.currentTime >= clipEndTime) {
                      clearTimeout(timeoutId);
                      updateProgress(`Finished playing clip from ${file.name}, drew ${frameCount} frames`);
                      resolve();
                  } else {
                      // For debugging, log every second of playback
                      if (frameCount % 30 === 0) { // Assuming 30fps
                        updateProgress(`Playing ${file.name}: ${(video.currentTime - startTime).toFixed(1)}s / ${clipLength.toFixed(1)}s`);
                      }
                      requestAnimationFrame(drawFrame);
                  }
              } catch (e) {
                  errorOccurred = true;
                  clearTimeout(timeoutId);
                  updateError(`Error drawing video frame for ${file.name}`, e);
                  reject(e);
              }
          };
          
          drawFrame();
          
      }).catch((e) => {
          clearTimeout(timeoutId);
          errorOccurred = true;
          updateError(`Error playing clip from file ${file.name}: ${e.message}`, e);
          reject(e);
      });
  });
}
