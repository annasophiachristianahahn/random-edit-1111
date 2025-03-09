// Helper: Append progress messages into the status div
function updateProgress(message) {
  const statusDiv = document.getElementById('status');
  const p = document.createElement('p');
  p.textContent = message;
  statusDiv.appendChild(p);
  statusDiv.scrollTop = statusDiv.scrollHeight;
}

document.getElementById('start-button').addEventListener('click', async () => {
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

  if (!files.length) {
      updateProgress('Error: Please select at least one video file.');
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
      updateProgress('Error: Please enter valid numeric values.');
      return;
  }

  updateProgress('Starting video editing process...');
  await processVideos(files, finalLength, minClipLength, maxClipLength, zoomProbability, minZoom, maxZoom, finalWidth, finalHeight, flipProbability);
});

async function processVideos(files, finalLength, minClipLength, maxClipLength, zoomProbability, minZoom, maxZoom, finalWidth, finalHeight, flipProbability) {
  updateProgress('Initializing processing...');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const chunks = [];

  // Set canvas dimensions from the provided inputs.
  canvas.width = finalWidth;
  canvas.height = finalHeight;

  // Use a captureStream frame rate of 30 FPS (can be adjusted)
  const stream = canvas.captureStream(30);

  // Use H.264 codec and set a bitrate of 8 Mbps (8,000,000 bps)
  let options = {
      mimeType: 'video/mp4; codecs="avc1.42E01E"',
      videoBitsPerSecond: 8000000
  };

  let recorder;
  try {
      recorder = new MediaRecorder(stream, options);
  } catch (e) {
      updateProgress('H.264 configuration not supported, using default settings.');
      recorder = new MediaRecorder(stream);
  }

  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const videoURL = URL.createObjectURL(blob);
      document.getElementById('output-video').src = videoURL;
      updateProgress('Video processing completed.');

      // Show and configure the DOWNLOAD button
      const downloadBtn = document.getElementById('download-button');
      downloadBtn.style.display = 'block';
      downloadBtn.onclick = () => {
          const a = document.createElement('a');
          a.href = videoURL;
          a.download = 'final_video.mp4';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
      };
  };

  // Build randomized clip configurations until total duration meets or exceeds finalLength.
  let totalDuration = 0;
  let lastIndex = -1;
  const clipConfs = [];
  const filesArray = Array.from(files);
  updateProgress('Building clip configurations...');
  while (totalDuration < finalLength) {
      let idx = Math.floor(Math.random() * filesArray.length);
      // If there is more than one file and the index matches last selected, choose the next index.
      if (filesArray.length > 1 && idx === lastIndex) {
          idx = (idx + 1) % filesArray.length;
      }
      lastIndex = idx;
      const randFile = filesArray[idx];
      const duration = await getVideoDuration(randFile);
      const clipLength = getRandomClipLength(minClipLength, maxClipLength, duration);
      const startTime = getRandomStartTime(duration, clipLength);
      clipConfs.push({ file: randFile, startTime, clipLength });
      totalDuration += clipLength;
      updateProgress(`Added clip from ${randFile.name}: start=${startTime.toFixed(2)}s, length=${clipLength.toFixed(2)}s. Total planned duration: ${totalDuration.toFixed(2)}s`);
  }

  // Create 4 video elements for a larger preloading pipeline.
  const videoPlayers = [];
  for (let i = 0; i < 4; i++) {
      const video = document.createElement('video');
      // Prevent full-screen on iPhone by enabling inline playback.
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;
      video.autoplay = true;
      videoPlayers.push(video);
  }

  // Preload the first clip into slot 0.
  if (clipConfs.length === 0) {
      updateProgress('No clips to process.');
      return;
  }
  const firstClip = clipConfs.shift();
  updateProgress(`Preloading first clip from ${firstClip.file.name} (start: ${firstClip.startTime.toFixed(2)}s, length: ${firstClip.clipLength.toFixed(2)}s) into slot 0`);
  await preloadClip(videoPlayers[0], firstClip.file, firstClip.startTime, firstClip.clipLength);
  videoPlayers[0].clipConf = firstClip;

  // Preload remaining clips into slots 1 to 3, if available.
  for (let i = 1; i < videoPlayers.length; i++) {
      if (clipConfs.length > 0) {
          const clip = clipConfs.shift();
          updateProgress(`Preloading clip from ${clip.file.name} (start: ${clip.startTime.toFixed(2)}s, length: ${clip.clipLength.toFixed(2)}s) into slot ${i}`);
          await preloadClip(videoPlayers[i], clip.file, clip.startTime, clip.clipLength);
          videoPlayers[i].clipConf = clip;
      }
  }

  // Start recording and capture the recording start time.
  recorder.start();
  const recordStartTime = performance.now();
  updateProgress('Recording started.');

  let currentPlayerIndex = 0;
  let previousClip = null;
  // Build zoomConfig including the new flipProbability.
  const zoomConfig = { zoomProbability, minZoom, maxZoom, flipProbability };

  // Continue playing clips while the overall elapsed time is less than finalLength.
  while (performance.now() - recordStartTime < finalLength * 1000) {
      if (!videoPlayers[currentPlayerIndex].clipConf) break;
      const currentVideo = videoPlayers[currentPlayerIndex];
      const currentClip = currentVideo.clipConf;

      // Pass recordStartTime and finalLength so the clip stops drawing when time is up.
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
          await preloadClip(
              videoPlayers[nextIndex],
              upcoming.file,
              upcoming.startTime,
              upcoming.clipLength
          );
          videoPlayers[nextIndex].clipConf = upcoming;
      }
      await playPromise;

      previousClip = { video: currentVideo, conf: currentClip };
      currentPlayerIndex = (currentPlayerIndex + 1) % videoPlayers.length;
  }

  // If playback ended early, wait until finalLength has elapsed.
  const elapsed = performance.now() - recordStartTime;
  if (elapsed < finalLength * 1000) {
      await new Promise(resolve => setTimeout(resolve, finalLength * 1000 - elapsed));
  }

  recorder.stop();
  updateProgress('Recording stopped.');
}

function getVideoDuration(file) {
  return new Promise((resolve) => {
      const tempVideo = document.createElement('video');
      tempVideo.src = URL.createObjectURL(file);
      tempVideo.onloadedmetadata = () => resolve(tempVideo.duration);
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
      video.src = URL.createObjectURL(file);
      video.currentTime = startTime;
      video.onloadedmetadata = () => {
          video.onseeked = () => resolve();
          video.onerror = (e) => reject(e);
      };
      video.onerror = (e) => reject(e);
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
      
      if (applyZoom) {
          zoomFactor = Math.random() * ((zoomConfig.maxZoom - zoomConfig.minZoom) / 100) + (zoomConfig.minZoom / 100);
          zoomedSW = baseSW / zoomFactor;
          zoomedSH = baseSH / zoomFactor;
          const maxOffsetX = baseSW - zoomedSW;
          const maxOffsetY = baseSH - zoomedSH;
          fixedOffsetX = baseSX + Math.random() * maxOffsetX;
          fixedOffsetY = baseSY + Math.random() * maxOffsetY;
          updateProgress(`Applied zoom on ${file.name}: ${(zoomFactor * 100).toFixed(0)}%, crop at x:${fixedOffsetX.toFixed(0)}, y:${fixedOffsetY.toFixed(0)}`);
      }
      
      // Determine if the clip should be flipped horizontally.
      const flipClip = Math.random() < (zoomConfig.flipProbability / 100);
      if (flipClip) {
          updateProgress(`Applied horizontal flip on ${file.name}`);
      }
      
      video.play().then(() => {
          const drawFrame = () => {
              if (performance.now() - recordStartTime >= finalLength * 1000) {
                  resolve();
                  return;
              }
              ctx.clearRect(0, 0, canvas.width, canvas.height);

              // Draw previous clip during the overlap period.
              if (previousClip && video.currentTime < startTime + overlapDuration) {
                  ctx.drawImage(previousClip.video, 0, 0, canvas.width, canvas.height);
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
                  resolve();
              } else {
                  requestAnimationFrame(drawFrame);
              }
          };
          drawFrame();
      }).catch((e) => {
          updateProgress(`Error playing clip from file ${file.name}: ${e.message}`);
          console.error(`Error playing clip from file: ${file.name}`, e);
          reject(e);
      });
  });
}