(() => {
  "use strict";

  const OUTPUT_WIDTH = 720;
  const OUTPUT_HEIGHT = 1280;
  const TARGET_ASPECT = OUTPUT_WIDTH / OUTPUT_HEIGHT;
  const RENDER_FPS = 30;
  const HIGHLIGHT_SECONDS = 30;

  const ui = {
    body: document.body,
    fileInput: document.getElementById("fileInput"),
    dropZone: document.getElementById("dropZone"),
    sourceCard: document.getElementById("sourceCard"),
    sourcePreview: document.getElementById("sourcePreview"),
    sourceName: document.getElementById("sourceName"),
    sourceMeta: document.getElementById("sourceMeta"),
    sourceNote: document.getElementById("sourceNote"),
    replaceBtn: document.getElementById("replaceBtn"),
    durationButtons: [...document.querySelectorAll(".duration-button")],
    framingMode: document.getElementById("framingMode"),
    createBtn: document.getElementById("createBtn"),
    createBtnLabel: document.querySelector("#createBtn span"),
    formatNote: document.getElementById("formatNote"),
    progressPanel: document.getElementById("progressPanel"),
    progressTitle: document.getElementById("progressTitle"),
    progressMessage: document.getElementById("progressMessage"),
    progressTrack: document.getElementById("progressTrack"),
    progressBar: document.getElementById("progressBar"),
    progressPercent: document.getElementById("progressPercent"),
    progressDetail: document.getElementById("progressDetail"),
    cancelBtn: document.getElementById("cancelBtn"),
    renderCanvas: document.getElementById("renderCanvas"),
    resultPanel: document.getElementById("resultPanel"),
    resultVideo: document.getElementById("resultVideo"),
    resultMeta: document.getElementById("resultMeta"),
    sourceTimeline: document.getElementById("sourceTimeline"),
    downloadBtn: document.getElementById("downloadBtn"),
    shareBtn: document.getElementById("shareBtn"),
    makeAnotherBtn: document.getElementById("makeAnotherBtn"),
    errorBanner: document.getElementById("errorBanner"),
    errorTitle: document.getElementById("errorTitle"),
    errorMessage: document.getElementById("errorMessage"),
    dismissErrorBtn: document.getElementById("dismissErrorBtn"),
    installAppBtn: document.getElementById("installAppBtn")
  };

  const state = {
    file: null,
    sourceUrl: "",
    sourceDuration: 0,
    outputMinutes: 2,
    framingMode: "balanced",
    running: false,
    cancelled: false,
    activeVideo: null,
    activeVideos: [],
    recorder: null,
    captureStream: null,
    audioContext: null,
    wakeLock: null,
    resultUrl: "",
    resultBlob: null,
    resultFileName: "",
    installPrompt: null,
    lastProgressPaint: 0
  };
  let sharedFaceDetector = null;
  let faceDetectorChecked = false;

  class CancelledError extends Error {
    constructor() {
      super("Processing was cancelled.");
      this.name = "CancelledError";
    }
  }

  initialize();

  function initialize() {
    drawCanvasPlaceholder();
    bindEvents();
    refreshCreateState();
    registerServiceWorker();
  }

  function bindEvents() {
    ui.fileInput.addEventListener("click", () => {
      if (!state.running) ui.fileInput.value = "";
    });

    ui.fileInput.addEventListener("change", () => {
      const [file] = ui.fileInput.files || [];
      if (file) loadSourceFile(file);
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      ui.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        if (!state.running) ui.dropZone.classList.add("is-dragging");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      ui.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        ui.dropZone.classList.remove("is-dragging");
      });
    });

    ui.dropZone.addEventListener("drop", (event) => {
      if (state.running) return;
      const [file] = event.dataTransfer?.files || [];
      if (file) loadSourceFile(file);
    });

    ui.replaceBtn.addEventListener("click", () => {
      if (!state.running) {
        ui.fileInput.value = "";
        ui.fileInput.click();
      }
    });

    ui.durationButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (state.running) return;
        state.outputMinutes = Number(button.dataset.minutes);
        ui.durationButtons.forEach((item) => {
          const selected = item === button;
          item.classList.toggle("is-active", selected);
          item.setAttribute("aria-pressed", String(selected));
        });
        refreshCreateState();
      });
    });

    ui.framingMode.addEventListener("change", () => {
      if (!state.running) state.framingMode = ui.framingMode.value;
    });

    ui.createBtn.addEventListener("click", startProcessing);
    ui.cancelBtn.addEventListener("click", cancelProcessing);
    ui.dismissErrorBtn.addEventListener("click", hideError);
    ui.makeAnotherBtn.addEventListener("click", () => {
      ui.resultVideo.pause();
      ui.resultPanel.hidden = true;
      document.querySelector(".setup-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    ui.shareBtn.addEventListener("click", shareResult);

    window.addEventListener("beforeunload", (event) => {
      if (!state.running) return;
      event.preventDefault();
      event.returnValue = "";
    });

    document.addEventListener("visibilitychange", () => {
      if (state.running && document.visibilityState === "visible" && !state.wakeLock) {
        requestWakeLock();
      }
    });

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      ui.installAppBtn.hidden = false;
    });

    ui.installAppBtn.addEventListener("click", async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      await state.installPrompt.userChoice.catch(() => null);
      state.installPrompt = null;
      ui.installAppBtn.hidden = true;
    });

    window.addEventListener("appinstalled", () => {
      state.installPrompt = null;
      ui.installAppBtn.hidden = true;
    });

    window.addEventListener("pagehide", () => {
      if (!state.running) cleanupObjectUrls();
    });
  }

  async function loadSourceFile(file) {
    hideError();

    if (!looksLikeVideo(file)) {
      showError("Choose a video file", "This file does not look like a supported video.");
      return;
    }

    ui.sourcePreview.pause();
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    state.file = file;
    state.sourceUrl = URL.createObjectURL(file);
    state.sourceDuration = 0;

    ui.sourcePreview.removeAttribute("src");
    ui.sourcePreview.load();
    ui.sourcePreview.src = state.sourceUrl;

    try {
      await loadVideoMetadata(ui.sourcePreview);
      state.sourceDuration = await resolveFiniteDuration(ui.sourcePreview);

      if (!Number.isFinite(state.sourceDuration) || state.sourceDuration <= 0) {
        throw new Error("The browser could not read this video's duration.");
      }

      ui.sourceName.textContent = file.name;
      ui.sourceMeta.textContent = `${formatDuration(state.sourceDuration)} • ${formatBytes(file.size)} • ${formatVideoSize(ui.sourcePreview)}`;
      ui.dropZone.hidden = true;
      ui.sourceCard.hidden = false;
      ui.resultPanel.hidden = true;
      refreshCreateState();
    } catch (error) {
      state.sourceDuration = 0;
      ui.dropZone.hidden = false;
      ui.sourceCard.hidden = true;
      showError(
        "This video cannot be opened",
        "Try MP4 (H.264), MOV, M4V, or WebM. Some MKV, AVI, and older camera codecs are not playable in browsers."
      );
      console.error(error);
    }
  }

  function looksLikeVideo(file) {
    if (file.type?.startsWith("video/")) return true;
    return /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(file.name || "");
  }

  function refreshCreateState() {
    const targetSeconds = state.outputMinutes * 60;
    const capabilities = getCapabilities();
    const hasFile = Boolean(state.file && state.sourceDuration);
    const longEnough = state.sourceDuration >= targetSeconds - 0.1;

    ui.createBtnLabel.textContent = `Create ${state.outputMinutes}-minute short`;
    ui.createBtn.disabled = state.running || !hasFile || !longEnough || !capabilities.supported;

    if (!capabilities.supported) {
      ui.formatNote.textContent = "This browser cannot record processed video. Use a current Chrome, Edge, or Safari browser.";
    } else {
      const format = capabilities.preferredMime.includes("mp4") ? "MP4" : capabilities.preferredMime ? "WebM" : "video";
      ui.formatNote.textContent = `${format} output on this browser • processing stays on this device`;
    }

    if (!hasFile) {
      ui.sourceNote.textContent = "Preview the video here before processing.";
      return;
    }

    if (!longEnough) {
      ui.sourceNote.textContent = `This video is ${formatDuration(state.sourceDuration)}. Choose a shorter output length.`;
      ui.sourceNote.style.color = "var(--warning)";
    } else {
      ui.sourceNote.textContent = `Ready for ${state.outputMinutes} minute${state.outputMinutes === 1 ? "" : "s"} of ordered moments from the full timeline.`;
      ui.sourceNote.style.color = "";
    }
  }

  function getCapabilities() {
    const canCaptureCanvas = typeof ui.renderCanvas.captureStream === "function";
    const canRecord = typeof window.MediaRecorder === "function";
    const canCaptureAudio = Boolean(window.AudioContext || window.webkitAudioContext);
    const preferredMime = getSupportedMimeTypes()[0] || "";
    return {
      supported: canCaptureCanvas && canRecord && canCaptureAudio,
      preferredMime
    };
  }

  function getSupportedMimeTypes() {
    const mp4 = [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      "video/mp4"
    ];
    const webm = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];
    const ordered = [...mp4, ...webm];

    if (typeof window.MediaRecorder !== "function") return [];
    if (typeof MediaRecorder.isTypeSupported !== "function") return [""];
    return ordered.filter((type) => MediaRecorder.isTypeSupported(type));
  }

  async function startProcessing() {
    if (state.running || !state.file) return;

    const targetSeconds = state.outputMinutes * 60;
    if (state.sourceDuration < targetSeconds - 0.1) {
      showError("Video is too short", "Choose an output length shorter than the source video.");
      return;
    }

    if (!getCapabilities().supported) {
      showError("Browser not supported", "Open this page in a current Chrome, Edge, or Safari browser.");
      return;
    }

    hideError();
    clearPreviousResult();
    state.running = true;
    state.cancelled = false;
    state.lastProgressPaint = 0;
    lockControls(true);
    ui.sourcePreview.pause();
    ui.resultPanel.hidden = true;
    ui.progressPanel.hidden = false;
    ui.progressPanel.setAttribute("aria-busy", "true");
    ui.cancelBtn.disabled = false;
    ui.cancelBtn.textContent = "Cancel processing";
    setProgress(1, "Preparing your video", "Starting the private local processor…", "Keep this page open");
    ui.progressPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    let pipeline = null;

    try {
      // Start media and audio while this function still has the user's click permission.
      pipeline = primeProcessingPipeline();
      state.activeVideo = pipeline.video;
      state.activeVideos = pipeline.videos;
      state.audioContext = pipeline.audioContext;
      await Promise.all([pipeline.ready, requestWakeLock()]);
      throwIfCancelled();

      const candidates = await analyzeVideo(pipeline.video, state.sourceDuration, targetSeconds);
      throwIfCancelled();

      setProgress(35, "Choosing the best moments", "Keeping longer moments in the original order…", "Selection almost ready");
      const selectedSegments = selectSegments(candidates, targetSeconds, state.sourceDuration);
      const segments = await refineSegmentSafety(pipeline.video, selectedSegments, state.sourceDuration);
      throwIfCancelled();

      const result = await renderSegments(pipeline, segments, targetSeconds);
      throwIfCancelled();
      showResult(result, segments);
    } catch (error) {
      if (error instanceof CancelledError || state.cancelled) {
        setProgress(0, "Processing cancelled", "No output file was saved.", "Choose Create when you are ready");
        await delay(350);
        ui.progressPanel.hidden = true;
      } else {
        console.error(error);
        ui.progressPanel.hidden = true;
        const friendly = describeProcessingError(error);
        showError(friendly.title, friendly.message);
      }
    } finally {
      await cleanupPipeline(pipeline);
      state.running = false;
      state.cancelled = false;
      state.activeVideo = null;
      state.activeVideos = [];
      state.recorder = null;
      state.captureStream = null;
      state.audioContext = null;
      ui.progressPanel.removeAttribute("aria-busy");
      lockControls(false);
      await releaseWakeLock();
      refreshCreateState();
    }
  }

  function primeProcessingPipeline() {
    const videos = [0, 1].map(() => {
      const video = document.createElement("video");
      video.className = "work-video";
      video.playsInline = true;
      video.preload = "auto";
      video.volume = 1;
      video.muted = false;
      video.src = state.sourceUrl;
      document.body.appendChild(video);
      return video;
    });
    let audioContext = null;
    let audioDestination = null;
    const mediaSources = [];
    const gainNodes = [];
    let audioSetupError = null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (AudioContextClass) {
      try {
        audioContext = new AudioContextClass();
        audioDestination = audioContext.createMediaStreamDestination();
        videos.forEach((video) => {
          const mediaSource = audioContext.createMediaElementSource(video);
          const gainNode = audioContext.createGain();
          gainNode.gain.value = 0;
          mediaSource.connect(gainNode);
          gainNode.connect(audioDestination);
          mediaSources.push(mediaSource);
          gainNodes.push(gainNode);
        });
        audioContext.resume().catch(() => null);
      } catch (error) {
        console.warn("Original-audio capture could not be prepared.", error);
        audioSetupError = error;
        audioDestination = null;
        videos.forEach((video) => {
          video.muted = true;
        });
      }
    } else {
      videos.forEach((video) => {
        video.muted = true;
      });
    }

    const metadataReady = Promise.all(videos.map((video) => loadVideoMetadata(video)));
    const primingPlay = Promise.all(
      videos.map((video) =>
        video.play()
          .then(() => {
            video.pause();
            if (video.currentTime > 0.2) video.currentTime = 0;
          })
          .catch(() => null)
      )
    );

    const ready = Promise.all([metadataReady, primingPlay]).then(async () => {
      await Promise.all(videos.map((video) => resolveFiniteDuration(video)));
      videos.forEach((video) => video.pause());
      if (!audioDestination) {
        const error = new Error(audioSetupError?.message || "Original-audio capture is not supported by this browser.");
        error.name = "NotSupportedError";
        throw error;
      }
    });

    return {
      video: videos[0],
      videos,
      audioContext,
      audioDestination,
      mediaSources,
      gainNodes,
      ready
    };
  }

  async function analyzeVideo(video, duration, targetSeconds) {
    const clipCount = Math.max(3, Math.ceil(targetSeconds / HIGHLIGHT_SECONDS));
    const sampleCount = Math.min(
      180,
      Math.max(42, clipCount * 5, Math.ceil(duration / 45))
    );
    const halfClip = HIGHLIGHT_SECONDS / 2;
    const firstTime = Math.min(halfClip, Math.max(0, duration / 4));
    const lastTime = Math.max(firstTime, duration - halfClip - 0.6);
    const pairOffset = Math.min(0.45, Math.max(0.18, duration / sampleCount / 8));
    const width = 176;
    const height = clamp(Math.round(width * (video.videoHeight / video.videoWidth)), 96, 198);
    const analysisCanvas = document.createElement("canvas");
    analysisCanvas.width = width;
    analysisCanvas.height = height;
    const context = analysisCanvas.getContext("2d", { willReadFrequently: true });
    const candidates = [];

    setProgress(3, "Scanning your video", `Checking ${sampleCount} moments across ${formatDuration(duration)}…`, "Keep this page open");

    for (let index = 0; index < sampleCount; index += 1) {
      throwIfCancelled();
      const ratio = sampleCount === 1 ? 0.5 : index / (sampleCount - 1);
      const time = firstTime + (lastTime - firstTime) * ratio;

      await seekVideo(video, time);
      const firstFrame = readGrayFrame(video, context, width, height);
      await seekVideo(video, Math.min(duration - 0.08, time + pairOffset));
      const secondFrame = readGrayFrame(video, context, width, height);
      const metrics = compareFrames(firstFrame, secondFrame, width, height);
      candidates.push({ time, ...metrics });

      const percent = 3 + ((index + 1) / sampleCount) * 31;
      setProgress(
        percent,
        "Scanning your video",
        `Checking moment ${index + 1} of ${sampleCount}…`,
        `${formatDuration(time)} / ${formatDuration(duration)}`,
        true
      );

      if (index % 4 === 3) await waitForPaint();
    }

    scoreCandidates(candidates);
    return candidates;
  }

  function readGrayFrame(video, context, width, height) {
    context.drawImage(video, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);

    for (let pixel = 0, rgbaIndex = 0; pixel < gray.length; pixel += 1, rgbaIndex += 4) {
      gray[pixel] = Math.round(rgba[rgbaIndex] * 0.299 + rgba[rgbaIndex + 1] * 0.587 + rgba[rgbaIndex + 2] * 0.114);
    }
    return gray;
  }

  function compareFrames(first, second, width, height) {
    let brightness = 0;
    let clipped = 0;
    let sharpness = 0;
    let salienceTotal = 0;
    let salienceWeightedX = 0;
    const columns = new Float64Array(width);

    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const index = y * width + x;
        const value = second[index];
        const edge = Math.abs(value - second[index - 1]) + Math.abs(value - second[index - width]);
        const change = Math.abs(value - first[index]);
        const centerWeight = 0.58 + 0.42 * Math.exp(-Math.pow((x / width - 0.5) / 0.32, 2));
        const salience = (edge * 0.54 + change * 0.72) * centerWeight;

        brightness += value;
        if (value < 14 || value > 242) clipped += 1;
        sharpness += edge;
        columns[x] += salience;
        salienceTotal += salience;
        salienceWeightedX += salience * x;
      }
    }

    const samples = Math.floor((width - 2) / 2) * Math.floor((height - 2) / 2) || 1;
    const meanBrightness = brightness / samples;
    const exposure = clamp(
      1 - Math.abs(meanBrightness - 126) / 126 - (clipped / samples) * 0.7,
      0,
      1
    );
    const rawFocus = salienceTotal > 0 ? salienceWeightedX / salienceTotal / width : 0.5;
    const focusX = clamp(rawFocus * 0.82 + 0.5 * 0.18, 0.19, 0.81);

    const noShiftDifference = frameDifference(first, second, width, height, 0, 0);
    let bestDifference = noShiftDifference;
    let bestShift = 0;

    [-4, 0, 4].forEach((shiftY) => {
      [-4, 0, 4].forEach((shiftX) => {
        if (shiftX === 0 && shiftY === 0) return;
        const difference = frameDifference(first, second, width, height, shiftX, shiftY);
        if (difference < bestDifference) {
          bestDifference = difference;
          bestShift = Math.hypot(shiftX, shiftY);
        }
      });
    });

    return {
      motion: bestDifference,
      cameraMotion: Math.max(0, noShiftDifference - bestDifference) + bestShift * 0.45,
      sharpness: sharpness / samples,
      exposure,
      composition: salienceTotal / samples,
      focusX
    };
  }

  function frameDifference(first, second, width, height, shiftX, shiftY) {
    const margin = 6;
    let difference = 0;
    let samples = 0;

    for (let y = margin; y < height - margin; y += 3) {
      for (let x = margin; x < width - margin; x += 3) {
        const firstIndex = y * width + x;
        const secondIndex = (y + shiftY) * width + (x + shiftX);
        difference += Math.abs(first[firstIndex] - second[secondIndex]);
        samples += 1;
      }
    }
    return difference / Math.max(1, samples);
  }

  function scoreCandidates(candidates) {
    const motion = robustNormalize(candidates.map((item) => item.motion));
    const camera = robustNormalize(candidates.map((item) => item.cameraMotion));
    const sharpness = robustNormalize(candidates.map((item) => item.sharpness));
    const exposure = candidates.map((item) => item.exposure);
    const composition = robustNormalize(candidates.map((item) => item.composition));

    candidates.forEach((candidate, index) => {
      const centerSafety = 1 - Math.abs(candidate.focusX - 0.5) * 0.42;
      candidate.score =
        motion[index] * 0.22 +
        sharpness[index] * 0.28 +
        exposure[index] * 0.22 +
        composition[index] * 0.22 +
        centerSafety * 0.06 -
        camera[index] * 0.18;
    });

    if (candidates.length >= 3) {
      const original = candidates.map((item) => item.score);
      for (let index = 1; index < candidates.length - 1; index += 1) {
        candidates[index].score = original[index] * 0.7 + (original[index - 1] + original[index + 1]) * 0.15;
      }
    }
  }

  function robustNormalize(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const low = percentile(sorted, 0.1);
    const high = percentile(sorted, 0.9);
    const range = Math.max(0.0001, high - low);
    return values.map((value) => clamp((value - low) / range, 0, 1));
  }

  function percentile(sorted, ratio) {
    if (!sorted.length) return 0;
    const position = (sorted.length - 1) * ratio;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function selectSegments(candidates, targetSeconds, sourceDuration) {
    if (sourceDuration <= targetSeconds * 1.12) {
      return [{ start: 0, length: targetSeconds, focusX: 0.5, score: 1 }];
    }

    const clipLength = HIGHLIGHT_SECONDS;
    const clipCount = Math.max(3, Math.ceil(targetSeconds / clipLength));
    const segmentLengths = distributeDuration(targetSeconds, clipCount);
    const pool = candidates.map((candidate) => ({
      ...candidate,
      start: clamp(candidate.time - clipLength / 2, 0, sourceDuration - clipLength)
    }));
    const selected = [];

    for (let zoneIndex = 0; zoneIndex < clipCount; zoneIndex += 1) {
      const zoneStart = (sourceDuration * zoneIndex) / clipCount;
      const zoneEnd = (sourceDuration * (zoneIndex + 1)) / clipCount;
      const zoneCenter = (zoneStart + zoneEnd) / 2;
      const zoneWidth = Math.max(1, zoneEnd - zoneStart);
      const ranked = pool
        .filter((candidate) => candidate.time >= zoneStart && candidate.time < zoneEnd)
        .map((candidate) => ({
          candidate,
          adjustedScore: candidate.score + (1 - Math.abs(candidate.time - zoneCenter) / zoneWidth) * 0.08
        }))
        .sort((a, b) => b.adjustedScore - a.adjustedScore);

      const choice = ranked.find(({ candidate }) => isFarEnough(candidate, selected, clipLength))?.candidate;
      if (choice) selected.push(choice);
    }

    const globalRanked = [...pool].sort((a, b) => b.score - a.score);
    for (const candidate of globalRanked) {
      if (selected.length >= clipCount) break;
      if (isFarEnough(candidate, selected, clipLength)) selected.push(candidate);
    }

    while (selected.length < clipCount) {
      const index = selected.length;
      const midpoint = (sourceDuration * (index + 0.5)) / clipCount;
      selected.push({
        time: midpoint,
        start: clamp(midpoint - clipLength / 2, 0, sourceDuration - clipLength),
        focusX: 0.5,
        score: 0
      });
    }

    const ordered = selected
      .slice(0, clipCount)
      .sort((a, b) => a.time - b.time)
      .map((candidate, index) => ({
        start: clamp(candidate.time - segmentLengths[index] / 2, 0, sourceDuration - segmentLengths[index]),
        length: segmentLengths[index],
        focusX: candidate.focusX,
        score: candidate.score
      }));
    return placeSegmentsInSourceOrder(ordered, sourceDuration);
  }

  function placeSegmentsInSourceOrder(segments, sourceDuration) {
    let previousEnd = 0;
    return segments.map((segment, index) => {
      const remaining = segments.slice(index + 1).reduce((sum, item) => sum + item.length + 0.1, 0);
      const minimum = previousEnd + (index ? 0.1 : 0);
      const maximum = Math.max(minimum, sourceDuration - segment.length - remaining);
      const start = clamp(segment.start, minimum, maximum);
      previousEnd = start + segment.length;
      return { ...segment, start };
    });
  }

  function isFarEnough(candidate, selected, clipLength) {
    return selected.every((item) => Math.abs(item.start - candidate.start) >= clipLength * 1.08);
  }

  function distributeDuration(totalSeconds, count) {
    const base = Math.floor(totalSeconds / count);
    let remaining = Math.round(totalSeconds - base * count);
    return Array.from({ length: count }, () => {
      const length = base + (remaining > 0 ? 1 : 0);
      remaining -= remaining > 0 ? 1 : 0;
      return length;
    });
  }

  async function refineSegmentSafety(video, segments, sourceDuration) {
    const width = 96;
    const height = clamp(Math.round(width * (video.videoHeight / video.videoWidth)), 54, 108);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const refined = [];
    const shifts = [0, 3, -3, 6, -6];

    for (let index = 0; index < segments.length; index += 1) {
      throwIfCancelled();
      const segment = segments[index];
      let best = null;

      for (const shift of shifts) {
        const start = segment.start + shift;
        const previousEnd = refined.length ? refined[refined.length - 1].start + refined[refined.length - 1].length : 0;
        const nextStart = segments[index + 1]?.start ?? sourceDuration;
        if (start < previousEnd + (index ? 0.08 : 0) || start + segment.length > nextStart - (index + 1 < segments.length ? 0.08 : 0)) continue;
        const candidate = { ...segment, start };
        if (overlapsEarlierSegment(candidate, refined)) continue;

        const risk = await measureVisualRisk(video, context, width, height, candidate);
        if (!best || risk < best.risk) best = { segment: candidate, risk };
        if (risk < 0.28) break;
      }

      refined.push(best?.segment || segment);
      setProgress(
        35 + ((index + 1) / segments.length) * 6,
        "Checking the selected moments",
        `Protecting highlight ${index + 1} of ${segments.length} from dark frames…`,
        "Final safety check",
        true
      );
      if (index % 3 === 2) await waitForPaint();
    }

    return refined;
  }

  async function measureVisualRisk(video, context, width, height, segment) {
    const probeRatios = [0.15, 0.5, 0.85];
    let worstRisk = 0;

    for (const ratio of probeRatios) {
      await seekVideo(video, segment.start + segment.length * ratio);
      context.drawImage(video, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      let brightness = 0;
      let darkPixels = 0;
      let brightPixels = 0;
      let samples = 0;

      for (let offset = 0; offset < pixels.length; offset += 16) {
        const luma = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
        brightness += luma;
        if (luma < 18) darkPixels += 1;
        if (luma > 244) brightPixels += 1;
        samples += 1;
      }

      const mean = brightness / Math.max(1, samples);
      const darkRatio = darkPixels / Math.max(1, samples);
      const brightRatio = brightPixels / Math.max(1, samples);
      const risk =
        clamp((42 - mean) / 42, 0, 1) * 1.15 +
        clamp((darkRatio - 0.55) / 0.45, 0, 1) * 0.9 +
        clamp((mean - 224) / 31, 0, 1) * 0.8 +
        clamp((brightRatio - 0.6) / 0.4, 0, 1) * 0.5;
      worstRisk = Math.max(worstRisk, risk);
    }

    return worstRisk;
  }

  function overlapsEarlierSegment(candidate, earlierSegments) {
    const start = candidate.start;
    const end = start + candidate.length;
    return earlierSegments.some((other) => {
      const otherEnd = other.start + other.length;
      return start < otherEnd - 0.25 && end > other.start + 0.25;
    });
  }

  async function renderSegments(pipeline, segments, targetSeconds) {
    const { videos, audioContext, audioDestination, gainNodes } = pipeline;
    const firstVideo = videos[0];
    const canvas = ui.renderCanvas;
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;

    setProgress(41, "Building your vertical short", `Preparing ${segments.length} selected moments…`, "Original audio included");

    await seekVideo(firstVideo, segments[0].start);
    setActiveAudioSlot(gainNodes, 0, audioContext);
    const firstTracker = createCropTracker(segments[0].focusX, firstVideo);
    drawVerticalFrame(firstVideo, context, firstTracker, true);

    const canvasStream = canvas.captureStream(RENDER_FPS);
    const tracks = [...canvasStream.getVideoTracks()];
    if (audioDestination?.stream) tracks.push(...audioDestination.stream.getAudioTracks());
    const combinedStream = new MediaStream(tracks);
    state.captureStream = combinedStream;

    if (audioContext?.state === "suspended") {
      await audioContext.resume().catch(() => null);
    }

    const recording = startMediaRecorder(combinedStream);
    const { recorder, chunks, stopped } = recording;
    state.recorder = recorder;
    let completedSeconds = 0;

    try {
      for (let index = 0; index < segments.length; index += 1) {
        throwIfCancelled();
        const segment = segments[index];
        const activeSlot = index % videos.length;
        const video = videos[activeSlot];
        state.activeVideo = video;

        if (Math.abs(video.currentTime - segment.start) > 0.08) {
          await seekVideo(video, segment.start);
        }

        setActiveAudioSlot(gainNodes, activeSlot, audioContext);
        const tracker = createCropTracker(segment.focusX, video);
        const nextSegment = segments[index + 1];
        let nextPreparation = null;

        if (nextSegment) {
          const nextVideo = videos[(index + 1) % videos.length];
          nextVideo.pause();
          nextPreparation = seekVideo(nextVideo, nextSegment.start)
            .then(() => null)
            .catch((error) => error);
        }

        await playAndRenderSegment(video, context, tracker, segment, ({ elapsed }) => {
          const totalRendered = completedSeconds + elapsed;
          const percent = 41 + (totalRendered / targetSeconds) * 57;
          setProgress(
            percent,
            "Building your vertical short",
            `Rendering highlight ${index + 1} of ${segments.length}…`,
            `${formatDuration(totalRendered)} / ${formatDuration(targetSeconds)}`,
            true
          );
        });
        completedSeconds += segment.length;

        if (nextSegment) {
          const preparationError = await nextPreparation;
          if (preparationError) throw preparationError;
          const nextSlot = (index + 1) % videos.length;
          const nextVideo = videos[nextSlot];
          setActiveAudioSlot(gainNodes, nextSlot, audioContext);
          const nextTracker = createCropTracker(nextSegment.focusX, nextVideo);
          drawVerticalFrame(nextVideo, context, nextTracker, true);
        }
      }

      videos.forEach((video) => video.pause());
      setProgress(99, "Finishing your video", "Packing the video for download…", "Almost done");
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
    } catch (error) {
      videos.forEach((video) => video.pause());
      if (recorder.state !== "inactive") recorder.stop();
      await stopped.catch(() => null);
      throw error;
    } finally {
      canvasStream.getTracks().forEach((track) => track.stop());
      combinedStream.getTracks().forEach((track) => track.stop());
    }

    throwIfCancelled();
    const mimeType = recorder.mimeType || recording.mimeType || "video/webm";
    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) throw new Error("The browser created an empty video file.");
    const extension = mimeType.includes("mp4") ? "mp4" : "webm";
    const sourceBase = (state.file.name || "video").replace(/\.[^.]+$/, "");
    const safeBase = sourceBase.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "video";
    const fileName = `${safeBase}-short-${state.outputMinutes}m.${extension}`;

    return { blob, mimeType, fileName };
  }

  function setActiveAudioSlot(gainNodes, activeSlot, audioContext) {
    if (!audioContext) return;
    const now = audioContext.currentTime;
    gainNodes.forEach((gainNode, index) => {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(index === activeSlot ? 1 : 0, now);
    });
  }

  function startMediaRecorder(stream) {
    const mimeTypes = getSupportedMimeTypes();
    const attempts = mimeTypes.length ? mimeTypes : [""];
    let lastError = null;

    for (const mimeType of attempts) {
      try {
        const options = {
          videoBitsPerSecond: 3_600_000,
          audioBitsPerSecond: 128_000
        };
        if (mimeType) options.mimeType = mimeType;
        const recorder = new MediaRecorder(stream, options);
        const chunks = [];
        let resolveStopped;
        let rejectStopped;
        const stopped = new Promise((resolve, reject) => {
          resolveStopped = resolve;
          rejectStopped = reject;
        });

        recorder.addEventListener("dataavailable", (event) => {
          if (event.data?.size) chunks.push(event.data);
        });
        recorder.addEventListener("stop", () => resolveStopped());
        recorder.addEventListener("error", (event) => rejectStopped(event.error || new Error("Video recording failed.")));
        recorder.start(1000);
        return { recorder, chunks, stopped, mimeType };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("No supported video recording format was found.");
  }

  async function playAndRenderSegment(video, context, tracker, segment, onProgress) {
    const start = segment.start;
    const end = Math.min(video.duration - 0.02, start + segment.length);
    video.playbackRate = 1;

    if (Math.abs(video.currentTime - start) > 0.08) await seekVideo(video, start);
    drawVerticalFrame(video, context, tracker, true);

    try {
      await video.play();
    } catch (error) {
      const playbackError = new Error("The browser blocked video playback. Tap Create again and keep this page in front.");
      playbackError.name = error?.name || "NotAllowedError";
      throw playbackError;
    }

    await new Promise((resolve, reject) => {
      let lastAdvanceAt = performance.now();
      let lastTime = video.currentTime;
      let lastUiUpdate = 0;

      const timer = window.setInterval(() => {
        try {
          if (state.cancelled) throw new CancelledError();
          const now = performance.now();
          const currentTime = video.currentTime;

          if (currentTime > lastTime + 0.003) {
            lastTime = currentTime;
            lastAdvanceAt = now;
          }

          drawVerticalFrame(video, context, tracker, false);
          const elapsed = clamp(currentTime - start, 0, segment.length);
          if (now - lastUiUpdate > 180) {
            onProgress({ elapsed });
            lastUiUpdate = now;
          }

          if (currentTime >= end - 0.025 || video.ended) {
            window.clearInterval(timer);
            video.pause();
            onProgress({ elapsed: segment.length });
            resolve();
            return;
          }

          if (now - lastAdvanceAt > 30000) {
            window.clearInterval(timer);
            video.pause();
            reject(new Error("Video playback stopped responding during processing."));
          }
        } catch (error) {
          window.clearInterval(timer);
          video.pause();
          reject(error);
        }
      }, 1000 / RENDER_FPS);
    });
  }

  function createCropTracker(initialFocus, video) {
    const width = 150;
    const height = clamp(Math.round(width * (video.videoHeight / video.videoWidth)), 84, 170);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return {
      initialFocus: clamp(initialFocus || 0.5, 0.19, 0.81),
      focus: clamp(initialFocus || 0.5, 0.19, 0.81),
      target: clamp(initialFocus || 0.5, 0.19, 0.81),
      visualFocus: clamp(initialFocus || 0.5, 0.19, 0.81),
      faceFocus: null,
      faceSeenAt: 0,
      faceScanPending: false,
      blockDarkFrame: false,
      hasGoodFrame: false,
      canvas,
      context: canvas.getContext("2d", { willReadFrequently: true }),
      previous: null,
      frame: 0
    };
  }

  function drawVerticalFrame(video, context, tracker, forceTrack) {
    tracker.frame += 1;
    if (forceTrack || tracker.frame % 3 === 0) updateCropTracker(video, tracker);
    if (state.framingMode === "balanced" && (forceTrack || tracker.frame % 15 === 0)) requestFaceFocus(video, tracker);
    tracker.focus += (tracker.target - tracker.focus) * 0.055;

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return;
    if (tracker.blockDarkFrame && tracker.hasGoodFrame) return;
    if (state.framingMode === "whole") {
      drawContainedFrame(video, context, sourceWidth, sourceHeight);
      tracker.hasGoodFrame = true;
      return;
    }
    const sourceAspect = sourceWidth / sourceHeight;
    let sourceX = 0;
    let sourceY = 0;
    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;

    if (sourceAspect > TARGET_ASPECT) {
      cropWidth = sourceHeight * TARGET_ASPECT;
      sourceX = clamp(tracker.focus * sourceWidth - cropWidth / 2, 0, sourceWidth - cropWidth);
    } else if (sourceAspect < TARGET_ASPECT) {
      cropHeight = sourceWidth / TARGET_ASPECT;
      sourceY = Math.max(0, (sourceHeight - cropHeight) / 2);
    }

    context.fillStyle = "#000";
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    context.drawImage(
      video,
      sourceX,
      sourceY,
      cropWidth,
      cropHeight,
      0,
      0,
      OUTPUT_WIDTH,
      OUTPUT_HEIGHT
    );
    tracker.hasGoodFrame = true;
  }

  function drawContainedFrame(video, context, sourceWidth, sourceHeight) {
    const coverScale = Math.max(OUTPUT_WIDTH / sourceWidth, OUTPUT_HEIGHT / sourceHeight);
    const coverWidth = sourceWidth * coverScale;
    const coverHeight = sourceHeight * coverScale;
    context.fillStyle = "#10131c";
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    context.save();
    context.globalAlpha = 0.22;
    context.drawImage(video, (OUTPUT_WIDTH - coverWidth) / 2, (OUTPUT_HEIGHT - coverHeight) / 2, coverWidth, coverHeight);
    context.restore();
    context.fillStyle = "rgba(7, 9, 16, 0.65)";
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

    const fitScale = Math.min(OUTPUT_WIDTH / sourceWidth, OUTPUT_HEIGHT / sourceHeight);
    const fitWidth = sourceWidth * fitScale;
    const fitHeight = sourceHeight * fitScale;
    context.drawImage(video, (OUTPUT_WIDTH - fitWidth) / 2, (OUTPUT_HEIGHT - fitHeight) / 2, fitWidth, fitHeight);
  }

  function updateCropTracker(video, tracker) {
    const { canvas, context } = tracker;
    const width = canvas.width;
    const height = canvas.height;
    context.drawImage(video, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    const columns = new Float64Array(width);
    let brightness = 0;
    let darkPixels = 0;

    for (let pixel = 0, rgbaIndex = 0; pixel < gray.length; pixel += 1, rgbaIndex += 4) {
      gray[pixel] = Math.round(rgba[rgbaIndex] * 0.299 + rgba[rgbaIndex + 1] * 0.587 + rgba[rgbaIndex + 2] * 0.114);
      brightness += gray[pixel];
      if (gray[pixel] < 17) darkPixels += 1;
    }

    const meanBrightness = brightness / Math.max(1, gray.length);
    tracker.blockDarkFrame = meanBrightness < 23 || darkPixels / Math.max(1, gray.length) > 0.82;
    if (tracker.blockDarkFrame) {
      tracker.previous = gray;
      return;
    }

    let total = 0;
    let weightedX = 0;
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const index = y * width + x;
        const edge = Math.abs(gray[index] - gray[index - 1]) + Math.abs(gray[index] - gray[index - width]);
        const motion = tracker.previous ? Math.min(48, Math.abs(gray[index] - tracker.previous[index])) : 0;
        const centerPrior = 0.45 + 0.55 * Math.exp(-Math.pow((x / width - 0.5) / 0.34, 2));
        const verticalPosition = y / height;
        const verticalWeight = 0.8 + 0.2 * Math.exp(-Math.pow((verticalPosition - 0.5) / 0.4, 2));
        const salience = (edge * 0.42 + motion * 0.75) * centerPrior * verticalWeight;
        columns[x] += salience;
        total += salience;
        weightedX += salience * x;
      }
    }

    if (total > 0) {
      const rawDetected = weightedX / total / width;
      const detected = clamp(rawDetected, 0.14, 0.86);
      tracker.visualFocus = detected;
      let target = detected * 0.7 + tracker.initialFocus * 0.3;

      if (tracker.faceFocus !== null && performance.now() - tracker.faceSeenAt < 1300) {
        target = tracker.faceFocus * 0.45 + detected * 0.55;
      }

      tracker.target = clamp(target, 0.13, 0.87);
    }
    tracker.previous = gray;
  }

  function getFaceDetector() {
    if (faceDetectorChecked) return sharedFaceDetector;
    faceDetectorChecked = true;
    if (typeof window.FaceDetector !== "function") return null;
    try {
      sharedFaceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
    } catch (_) {
      sharedFaceDetector = null;
    }
    return sharedFaceDetector;
  }

  function requestFaceFocus(video, tracker) {
    const detector = getFaceDetector();
    if (!detector || tracker.faceScanPending || video.readyState < 2) return;
    tracker.faceScanPending = true;

    detector.detect(video)
      .then((faces) => {
        if (!faces?.length) return;
        const relevant = faces
          .map((face) => {
            const box = face.boundingBox;
            const centerX = (box.x + box.width / 2) / Math.max(1, video.videoWidth);
            return { centerX, area: Math.max(1, box.width * box.height) };
          })
          .sort((a, b) => b.area - a.area)
          .slice(0, 3);
        const centers = relevant.map((face) => face.centerX);
        tracker.faceFocus = clamp((Math.min(...centers) + Math.max(...centers)) / 2, 0.12, 0.88);
        tracker.faceSeenAt = performance.now();
      })
      .catch(() => null)
      .finally(() => {
        tracker.faceScanPending = false;
      });
  }

  function showResult(result, segments) {
    state.resultBlob = result.blob;
    state.resultFileName = result.fileName;
    state.resultUrl = URL.createObjectURL(result.blob);
    ui.resultVideo.src = state.resultUrl;
    ui.downloadBtn.href = state.resultUrl;
    ui.downloadBtn.download = result.fileName;
    ui.resultMeta.textContent = `${state.outputMinutes}-minute vertical video • ${segments.length} ordered moments • ${formatBytes(result.blob.size)} • ${result.mimeType.includes("mp4") ? "MP4" : "WebM"}`;
    ui.sourceTimeline.replaceChildren(...segments.map((segment) => {
      const row = document.createElement("li");
      row.textContent = `${formatDuration(segment.start)} to ${formatDuration(segment.start + segment.length)} in the original video`;
      return row;
    }));

    const shareFile = new File([result.blob], result.fileName, { type: result.mimeType });
    ui.shareBtn.hidden = !(navigator.canShare && navigator.canShare({ files: [shareFile] }));
    ui.progressPanel.hidden = true;
    ui.resultPanel.hidden = false;
    ui.resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function shareResult() {
    if (!state.resultBlob || !navigator.share) return;
    const file = new File([state.resultBlob], state.resultFileName, { type: state.resultBlob.type });
    try {
      await navigator.share({ files: [file], title: state.resultFileName });
    } catch (error) {
      if (error?.name !== "AbortError") {
        showError("Could not open sharing", "Use Download video instead.");
      }
    }
  }

  function cancelProcessing() {
    if (!state.running) return;
    state.cancelled = true;
    ui.cancelBtn.disabled = true;
    ui.cancelBtn.textContent = "Cancelling…";
    const videos = state.activeVideos.length ? state.activeVideos : [state.activeVideo].filter(Boolean);
    videos.forEach((video) => video.pause());
    if (state.recorder && state.recorder.state !== "inactive") {
      try {
        state.recorder.stop();
      } catch (_) {
        // The normal cleanup path will finish the cancellation.
      }
    }
  }

  function throwIfCancelled() {
    if (state.cancelled) throw new CancelledError();
  }

  function lockControls(locked) {
    ui.fileInput.disabled = locked;
    ui.replaceBtn.disabled = locked;
    ui.durationButtons.forEach((button) => {
      button.disabled = locked;
    });
    ui.framingMode.disabled = locked;
    if (locked) ui.createBtn.disabled = true;
  }

  function setProgress(percent, title, message, detail, throttle = false) {
    const now = performance.now();
    if (throttle && now - state.lastProgressPaint < 90 && percent < 99) return;
    state.lastProgressPaint = now;
    const safePercent = clamp(percent, 0, 100);
    ui.progressTitle.textContent = title;
    ui.progressMessage.textContent = message;
    ui.progressDetail.textContent = detail;
    ui.progressBar.style.width = `${safePercent}%`;
    ui.progressTrack.setAttribute("aria-valuenow", String(Math.round(safePercent)));
    ui.progressPercent.textContent = `${Math.round(safePercent)}%`;
  }

  function drawCanvasPlaceholder() {
    const context = ui.renderCanvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    gradient.addColorStop(0, "#151827");
    gradient.addColorStop(1, "#090b12");
    context.fillStyle = gradient;
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    context.strokeStyle = "rgba(169,149,255,.22)";
    context.lineWidth = 3;
    context.strokeRect(95, 180, OUTPUT_WIDTH - 190, OUTPUT_HEIGHT - 360);
    context.fillStyle = "rgba(247,248,252,.55)";
    context.font = "700 34px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("VERTICAL PREVIEW", OUTPUT_WIDTH / 2, OUTPUT_HEIGHT / 2);
  }

  async function seekVideo(video, requestedTime) {
    throwIfCancelled();
    const duration = Number.isFinite(video.duration) ? video.duration : state.sourceDuration;
    const target = clamp(requestedTime, 0, Math.max(0, duration - 0.03));

    if (Math.abs(video.currentTime - target) < 0.025 && video.readyState >= 2) return;

    await new Promise((resolve, reject) => {
      let timeout;
      let cancellationPoll;

      const cleanup = () => {
        window.clearTimeout(timeout);
        window.clearInterval(cancellationPoll);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(video.error || new Error("The video could not seek to a selected moment."));
      };

      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("The video took too long to seek. Try converting the source to MP4 (H.264)."));
      }, 25000);
      cancellationPoll = window.setInterval(() => {
        if (!state.cancelled) return;
        cleanup();
        reject(new CancelledError());
      }, 120);

      try {
        video.currentTime = target;
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  function loadVideoMetadata(video) {
    if (video.readyState >= 1 && video.videoWidth) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeout);
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
      };
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(video.error || new Error("The browser could not open this video."));
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("The video took too long to load."));
      }, 30000);
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }

  async function resolveFiniteDuration(video) {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;

    const previousTime = video.currentTime;
    const durationChanged = waitForEvent(video, "durationchange", 5000).catch(() => null);
    try {
      video.currentTime = Number.MAX_SAFE_INTEGER;
      await durationChanged;
    } finally {
      video.currentTime = Number.isFinite(previousTime) ? previousTime : 0;
    }
    return video.duration;
  }

  function waitForEvent(target, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeout);
        target.removeEventListener(eventName, onEvent);
      };
      const onEvent = (event) => {
        cleanup();
        resolve(event);
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${eventName}.`));
      }, timeoutMs);
      target.addEventListener(eventName, onEvent, { once: true });
    });
  }

  async function cleanupPipeline(pipeline) {
    if (!pipeline) return;
    const videos = pipeline.videos || [pipeline.video].filter(Boolean);
    try {
      videos.forEach((video) => {
        video.pause();
        video.removeAttribute("src");
        video.load();
      });
      pipeline.mediaSources?.forEach((source) => source.disconnect());
      pipeline.gainNodes?.forEach((gainNode) => gainNode.disconnect());
    } catch (_) {
      // Best-effort media cleanup.
    }
    state.captureStream?.getTracks().forEach((track) => track.stop());
    if (pipeline.audioContext && pipeline.audioContext.state !== "closed") {
      await pipeline.audioContext.close().catch(() => null);
    }
    videos.forEach((video) => video.remove());
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
    } catch (_) {
      state.wakeLock = null;
    }
  }

  async function releaseWakeLock() {
    if (!state.wakeLock) return;
    const lock = state.wakeLock;
    state.wakeLock = null;
    await lock.release().catch(() => null);
  }

  function describeProcessingError(error) {
    const name = error?.name || "";
    const message = String(error?.message || "");
    if (name === "NotAllowedError" || /blocked video playback/i.test(message)) {
      return {
        title: "Playback permission was blocked",
        message: "Keep this page visible, tap Create again, and do not lock the screen while it works."
      };
    }
    if (name === "NotSupportedError" || /codec|format|record/i.test(message)) {
      return {
        title: "Video format is not supported",
        message: "Try a source MP4 encoded with H.264 video and AAC audio, or open the app in current Chrome or Safari."
      };
    }
    if (/memory|allocation|empty video/i.test(message)) {
      return {
        title: "This device ran out of video memory",
        message: "Close other apps, reload this page, and try again. For a two-hour video, use a Mac or Windows computer."
      };
    }
    return {
      title: "Processing could not finish",
      message: message || "Reload the page and try an MP4 (H.264) source video."
    };
  }

  function showError(title, message) {
    ui.errorTitle.textContent = title;
    ui.errorMessage.textContent = message;
    ui.errorBanner.hidden = false;
  }

  function hideError() {
    ui.errorBanner.hidden = true;
  }

  function clearPreviousResult() {
    ui.resultVideo.pause();
    ui.resultVideo.removeAttribute("src");
    ui.resultVideo.load();
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = "";
    state.resultBlob = null;
    state.resultFileName = "";
  }

  function cleanupObjectUrls() {
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => null);
    });
  }

  function formatDuration(seconds) {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const remainingSeconds = safeSeconds % 60;
    if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let amount = value / 1024;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) {
      amount /= 1024;
      index += 1;
    }
    const decimals = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
    return `${amount.toFixed(decimals)} ${units[index]}`;
  }

  function formatVideoSize(video) {
    return video.videoWidth && video.videoHeight ? `${video.videoWidth}×${video.videoHeight}` : "video";
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function waitForPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
})();
