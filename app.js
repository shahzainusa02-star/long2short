(() => {
  "use strict";

  const OUTPUT_WIDTH = 720;
  const OUTPUT_HEIGHT = 1280;
  const TARGET_ASPECT = OUTPUT_WIDTH / OUTPUT_HEIGHT;
  const RENDER_FPS = 30;
  // Hold each moment long enough to show a visible step of the process.

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
    useOpeningTeaser: document.getElementById("useOpeningTeaser"),
    openingStart: document.getElementById("openingStart"),
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
    useOpeningTeaser: false,
    teaserEnd: 0,
    usedOpeningTeaser: false,
    skippedPreview: 0,
    skipMethod: null,
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
    ui.useOpeningTeaser.addEventListener("change", () => {
      if (!state.running) state.useOpeningTeaser = ui.useOpeningTeaser.checked;
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
    ui.openingStart.value = "";

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

    ui.createBtnLabel.textContent = `Create ${state.outputMinutes}-minute preview`;
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
      ui.sourceNote.textContent = `Ready for a fast-cut preview of the whole video in ${state.outputMinutes} minute${state.outputMinutes === 1 ? "" : "s"}.`;
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

    const manualStart = parseSourceStart(ui.openingStart.value);
    if (Number.isNaN(manualStart)) {
      showError("Check the start time", "Use minutes:seconds, such as 1:18, or leave this field empty for automatic selection.");
      return;
    }
    if (manualStart !== null && manualStart > state.sourceDuration - targetSeconds - 0.5) {
      showError("Start time is too late", "Choose a time that leaves enough of the original video for the preview.");
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

      state.teaserEnd = manualStart === null
        ? await detectIntroPreview(pipeline.video, state.sourceDuration, targetSeconds)
        : 0;
      const openingPlan = planOpening(targetSeconds, state.teaserEnd, state.useOpeningTeaser, manualStart);
      state.skippedPreview = openingPlan.skippedPreview;
      state.skipMethod = manualStart !== null ? "manual" : state.skippedPreview ? "automatic" : null;
      const teaserLength = openingPlan.teaserLength;
      state.usedOpeningTeaser = teaserLength > 0;
      const sourceStart = openingPlan.sourceStart;
      const contentSeconds = targetSeconds - teaserLength;
      const candidates = contentSeconds < 0.01 || state.sourceDuration - sourceStart <= contentSeconds * 1.12
        ? []
        : await analyzeVideo(pipeline.video, state.sourceDuration, targetSeconds, sourceStart);
      throwIfCancelled();

      setProgress(35, "Building a fast-cut preview", "Keeping short action beats in source order…", "Selection almost ready");
      const selectedSegments = selectSegments(candidates, targetSeconds, state.sourceDuration, sourceStart, teaserLength);
      const segments = await refineSegmentSafety(pipeline.video, selectedSegments, state.sourceDuration, teaserLength ? 0 : sourceStart);
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
    const videos = [0, 1, 2].map(() => {
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

  async function detectIntroPreview(video, duration, targetSeconds) {
    if (duration < 300 || duration - targetSeconds < 120) return 0;
    const step = 3;
    const probeEnd = Math.min(150, duration - targetSeconds - 1);
    const width = 96;
    const height = clamp(Math.round(width * video.videoHeight / video.videoWidth), 54, 108);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const differences = [];
    let previous = null;

    setProgress(2, "Checking the opening", "Finding where the main video begins…", "Keep this page open");
    for (let time = 0; time <= probeEnd; time += step) {
      throwIfCancelled();
      // Register before seeking: `seeked` alone can report success while canvas
      // still contains the previous frame. That made real browser exports miss
      // pre-edited openings that were detected correctly in offline tests.
      await seekDecodedVideo(video, time);
      await waitForPaint();
      const current = readGrayFrame(video, context, width, height);
      if (previous) differences.push(frameDifference(previous, current, width, height, 0, 0));
      previous = current;
      const previewEnd = locateIntroPreview(differences, step);
      if (previewEnd) return previewEnd;
      if (time % 18 === 0) await waitForPaint();
    }

    return 0;
  }

  async function seekDecodedVideo(video, time, timeoutMs = 450) {
    const decoded = waitForDecodedVideoFrame(video, time, timeoutMs);
    try {
      await seekVideo(video, time);
    } finally {
      await decoded;
    }
  }

  function waitForDecodedVideoFrame(video, target, timeoutMs = 450) {
    if (typeof video.requestVideoFrameCallback !== "function") return Promise.resolve();
    return new Promise((resolve) => {
      let callbackId = null;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (callbackId !== null) video.cancelVideoFrameCallback?.(callbackId);
        resolve();
      };
      const check = (_, metadata) => {
        if (Math.abs(metadata.mediaTime - target) <= 0.5) finish();
        else if (!settled) callbackId = video.requestVideoFrameCallback(check);
      };
      const timeout = window.setTimeout(finish, timeoutMs);
      callbackId = video.requestVideoFrameCallback(check);
    });
  }

  function locateIntroPreview(differences, step = 3) {
    // Only recognize a distinct opening with many quick cuts followed by sustained footage.
    // A busy opening that stays busy is content, not a detectable teaser.
    if (differences.length < 21) return 0;
    const hasFastOpening = differences.slice(0, 12).filter((value) => value >= 42).length >= 6;
    if (!hasFastOpening) return 0;

    for (let index = 14; index + 7 <= differences.length; index += 1) {
      const before = differences.slice(index - 12, index);
      const after = differences.slice(index, index + 7);
      if (before.filter((value) => value >= 42).length < 6) continue;
      if (after.filter((value) => value <= 38).length < 6) continue;
      const beforeAverage = before.reduce((total, value) => total + value, 0) / before.length;
      const afterAverage = after.reduce((total, value) => total + value, 0) / after.length;
      if (beforeAverage < afterAverage * 1.55) continue;
      return Math.round((index + 1) * step);
    }
    return 0;
  }

  function planOpening(targetSeconds, teaserEnd, useOpeningTeaser, manualStart) {
    // The default samples the whole main video in chronological order.
    // An existing edited opening can be reused only when explicitly requested
    // for a one-minute result, never before a longer edit that would jump back.
    const keepEditedOpening = manualStart === null && useOpeningTeaser &&
      targetSeconds <= 60 && teaserEnd >= targetSeconds + 2;
    const teaserLength = keepEditedOpening ? targetSeconds : 0;
    const skippedPreview = keepEditedOpening ? 0 : manualStart ?? teaserEnd;
    return { teaserLength, skippedPreview, sourceStart: teaserLength ? teaserEnd : skippedPreview };
  }

  function parseSourceStart(raw) {
    const value = String(raw).trim();
    if (!value) return null;
    const pieces = value.split(":");
    if (pieces.length < 2 || pieces.length > 3 || pieces.some((part) => !/^\d+$/.test(part))) return NaN;
    const numbers = pieces.map(Number);
    if (numbers.at(-1) >= 60 || (numbers.length === 3 && numbers[1] >= 60)) return NaN;
    return numbers.length === 2
      ? numbers[0] * 60 + numbers[1]
      : numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  }

  async function analyzeVideo(video, duration, targetSeconds, skipIntro = 0) {
    const clipCount = previewChapterCount(targetSeconds);
    const sampleCount = Math.min(
      360,
      Math.max(100, clipCount * 2, Math.ceil(duration / 35))
    );
    const halfClip = targetSeconds / clipCount / 2;
    const firstTime = clamp(skipIntro + halfClip, 0, Math.max(0, duration - halfClip - 0.6));
    const lastTime = Math.max(firstTime, duration - halfClip - 0.6);
    // Slower actions (washing, assembling, demonstrations) need more than a
    // split-second sample to register as activity.
    const pairOffset = Math.min(0.8, Math.max(0.3, duration / sampleCount / 8));
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

      await seekDecodedVideo(video, time, 240);
      const firstFrame = readGrayFrame(video, context, width, height);
      await seekDecodedVideo(video, Math.min(duration - 0.08, time + pairOffset), 240);
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
    let centralActivity = 0;
    let centralPixels = 0;
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
        if (x > width * 0.16 && x < width * 0.84 && y > height * 0.1 && y < height * 0.9) {
          centralActivity += edge > 22 || change > 12 ? 1 : 0;
          centralPixels += 1;
        }
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
      subjectDetail: centralActivity / Math.max(1, centralPixels),
      signature: frameSignature(second, width, height),
      focusX
    };
  }

  function frameSignature(frame, width, height) {
    // A small image description lets us distinguish a nearby alternate shot
    // from a nearly identical view, without downloading a model or looking
    // for any specific object, person, or type of video.
    const signature = [];
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 10; column += 1) {
        const centerX = Math.floor((column + 0.5) * width / 10);
        const centerY = Math.floor((row + 0.5) * height / 6);
        let sum = 0;
        for (let y = -2; y <= 2; y += 2) {
          for (let x = -2; x <= 2; x += 2) {
            sum += frame[clamp(centerY + y, 0, height - 1) * width + clamp(centerX + x, 0, width - 1)];
          }
        }
        signature.push(Math.round(sum / 9));
      }
    }
    return signature;
  }

  function signatureDistance(first, second) {
    if (!first?.length || first.length !== second?.length) return 0.5;
    let difference = 0;
    for (let index = 0; index < first.length; index += 1) {
      difference += Math.abs(first[index] - second[index]);
    }
    return clamp(difference / first.length / 62, 0, 1);
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
    const subjectDetail = robustNormalize(candidates.map((item) => item.subjectDetail));

    candidates.forEach((candidate, index) => {
      const centerSafety = 1 - Math.abs(candidate.focusX - 0.5) * 0.42;
      candidate.score =
        motion[index] * 0.27 +
        sharpness[index] * 0.15 +
        exposure[index] * 0.16 +
        composition[index] * 0.14 +
        subjectDetail[index] * 0.19 +
        centerSafety * 0.09 -
        camera[index] * 0.18;
      // A bright but almost empty or unchanging room should not beat a
      // nearby shot of the actual action just because it is well exposed.
      if (motion[index] < 0.2 && subjectDetail[index] < 0.2) candidate.score -= 0.18;
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

  function selectSegments(candidates, targetSeconds, sourceDuration, skipIntro = 0, teaserLength = 0) {
    const openingLength = clamp(teaserLength, 0, Math.min(targetSeconds, skipIntro, sourceDuration));
    const opening = selectOpeningTeaser(openingLength, skipIntro);
    if (openingLength >= targetSeconds - 0.01) return opening;

    const remaining = targetSeconds - openingLength;
    const sourceStart = clamp(skipIntro, 0, Math.max(0, sourceDuration - remaining));
    if (sourceDuration - sourceStart <= remaining * 1.12) {
      return [...opening, { start: sourceStart, length: remaining, focusX: 0.5, score: 1 }];
    }

    const clipCount = Math.max(12, Math.round(previewChapterCount(targetSeconds) * remaining / targetSeconds));
    // A timeline sampled uniformly right up to its last second gives the
    // outcome only one tiny shot. Save a visible closing chapter for any long
    // video, regardless of its subject or the type of activity it contains.
    const closingWindow = Math.min(120, Math.max(42, sourceDuration * 0.035));
    const closingStart = sourceDuration - closingWindow;
    const hasClosing = sourceDuration >= 300 && closingStart - sourceStart > remaining * 1.12;
    const closingSeconds = hasClosing ? Math.min(18, Math.max(6, Math.round(targetSeconds * 0.1))) : 0;
    const closingCount = hasClosing ? Math.min(8, Math.max(3, Math.round(closingSeconds / 2))) : 0;
    const bodySeconds = remaining - closingSeconds;
    const bodyCount = clipCount - closingCount;
    const bodyEnd = hasClosing ? closingStart : sourceDuration;
    const segmentLengths = distributeFastDuration(bodySeconds, bodyCount);
    const usableDuration = bodyEnd - sourceStart;
    const clipLength = bodySeconds / bodyCount;
    const sourceGap = Math.min(usableDuration / bodyCount * 0.12,
      Math.max(0, (usableDuration - bodySeconds) / (bodyCount - 1) * 0.45));
    const pool = candidates.filter((candidate) => candidate.time < bodyEnd).map((candidate) => ({
      ...candidate,
      start: clamp(candidate.time - clipLength / 2, sourceStart, bodyEnd - clipLength)
    }));
    const selected = [];

    for (let index = 0; index < bodyCount; index += 1) {
      const previous = selected.at(-1);
      const earliest = previous ? previous.start + previous.length + sourceGap : sourceStart;
      const remainingLengths = segmentLengths.slice(index).reduce((sum, value) => sum + value, 0);
      const latest = bodyEnd - remainingLengths - (bodyCount - index - 1) * sourceGap;
      const ratio = index === bodyCount - 1 ? 0.985 : index / (bodyCount - 1) * 0.965;
      const expectedStart = sourceStart + usableDuration * ratio;
      const anchor = clamp(expectedStart, earliest, Math.max(earliest, latest));
      // Keep each beat near its own slice of the source. A wide search could
      // jump over a short but essential stage when its picture was less bright
      // than the adjacent stages (washing, setup, a slide change, etc.).
      const radius = Math.max(clipLength * 2, usableDuration / bodyCount * 0.55);
      const valid = pool.filter((item) => item.start >= earliest && item.start <= latest);
      const near = valid.filter((item) => Math.abs(item.start - anchor) <= radius);
      const choice = (near.length ? near : valid)
        .map((item) => ({ item, rank: rankCandidate(item, anchor, radius, selected) }))
        .sort((a, b) => b.rank - a.rank)[0]?.item;
      selected.push({
        start: index === 0 ? sourceStart
          : clamp(choice ? choice.time - segmentLengths[index] / 2 : anchor, earliest, Math.max(earliest, latest)),
        length: segmentLengths[index],
        focusX: choice?.focusX ?? 0.5,
        score: choice?.score ?? 0,
        signature: choice?.signature
      });
    }

    const body = placeSegmentsInSourceOrder(selected, bodyEnd, sourceStart);
    const closing = hasClosing
      ? selectClosingSegments(closingStart, sourceDuration, closingSeconds, closingCount, candidates, body.at(-1))
      : [];
    return [...opening, ...body, ...closing];
  }

  function rankCandidate(candidate, anchor, radius, selected) {
    const recentSignatures = selected.slice(-6).map((item) => item.signature).filter(Boolean);
    const distinctness = recentSignatures.length
      ? Math.min(...recentSignatures.map((previous) => signatureDistance(candidate.signature, previous)))
      : 0.5;
    const closeness = clamp(1 - Math.abs(candidate.start - anchor) / Math.max(0.01, radius), 0, 1);
    return candidate.score * 0.5 + closeness * 0.25 + distinctness * 0.25;
  }

  function selectClosingSegments(start, end, seconds, count, candidates = [], previous = null) {
    const finalHold = Math.min(seconds - (count - 1) * 0.75, Math.max(3, seconds * 0.25));
    const lengths = [...distributeFastDuration(seconds - finalHold, count - 1), finalHold];
    const lastStart = end - finalHold - 0.35;
    const openingSpan = Math.max(0, lastStart - start - lengths.slice(0, -1).reduce((sum, value) => sum + value, 0));
    let earliest = start;
    const selected = previous ? [previous] : [];
    return lengths.map((length, index) => {
      const isLast = index === count - 1;
      const position = isLast ? lastStart : start + openingSpan * index / (count - 1);
      const radius = Math.max(9, (end - start) / count * 0.6);
      const latest = isLast ? end - length
        : Math.min(lastStart - lengths.slice(index + 1, -1).reduce((sum, value) => sum + value + 0.1, 0),
          start + openingSpan * (index + 1) / (count - 1) - length - 0.08);
      const nearby = candidates.filter((item) => {
        const segmentStart = item.time - length / 2;
        return item.time >= start && item.time < end && segmentStart >= earliest && segmentStart <= latest &&
          Math.abs(segmentStart - position) <= (isLast ? 20 : radius);
      });
      // Prefer a clear, visually different outcome from the last few moments;
      // avoid holding on a blank outro just because it is the final frame.
      // If the scan missed the final seconds entirely, keep the actual ending
      // instead of mistakenly ending early on an old sample.
      const finalSamples = isLast
        ? nearby.filter((item) => item.time - length / 2 >= lastStart - 6)
        : [];
      const viableFinal = finalSamples.filter((item) => item.score >= 0.23);
      let choices = nearby;
      if (isLast && viableFinal.length) choices = viableFinal;
      if (isLast && !finalSamples.length) choices = [];
      const choice = choices.map((item) => ({
        item,
        rank: rankCandidate({ ...item, start: item.time - length / 2 }, position, isLast ? 20 : radius, selected)
      })).sort((a, b) => b.rank - a.rank)[0]?.item;
      const segmentStart = clamp(choice ? choice.time - length / 2 : position, earliest, Math.max(earliest, latest));
      earliest = segmentStart + length + (isLast ? 0 : 0.1);
      const segment = { start: segmentStart, length, focusX: choice?.focusX ?? 0.5,
        score: choice?.score ?? 0, signature: choice?.signature, isClosing: true };
      selected.push(segment);
      return segment;
    });
  }

  function previewChapterCount(targetSeconds) {
    // Fewer, longer source-order moments let process and tutorial steps show.
    return Math.max(22, Math.round(22 + (targetSeconds / 60 - 1) * 8));
  }

  function selectOpeningTeaser(length, teaserEnd) {
    if (!length) return [];
    const sectionCount = teaserEnd > length + 6 ? Math.max(2, Math.round(length / 10)) : 1;
    const sectionLength = length / sectionCount;
    const sourceSpan = sectionCount === 1 ? length
      : Math.min(teaserEnd - 4, length + Math.min(8, length * 0.16));
    return Array.from({ length: sectionCount }, (_, index) => ({
      start: sectionCount === 1 ? 0 : index / (sectionCount - 1) * (sourceSpan - sectionLength),
      length: sectionLength,
      focusX: 0.5,
      score: 1,
      isOpeningTeaser: true
    }));
  }

  function distributeFastDuration(totalSeconds, count) {
    const weights = Array.from({ length: count }, (_, index) => 1 + 0.2 * Math.sin((index + 1) * 2.4));
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    let remaining = totalSeconds;
    return weights.map((weight, index) => {
      if (index === count - 1) return Math.round(remaining * 100) / 100;
      const duration = Math.round(totalSeconds * weight / weightSum * 100) / 100;
      remaining -= duration;
      return duration;
    });
  }

  function placeSegmentsInSourceOrder(segments, sourceDuration, sourceStart = 0) {
    let previousEnd = sourceStart;
    return segments.map((segment, index) => {
      const remaining = segments.slice(index + 1).reduce((sum, item) => sum + item.length + 0.1, 0);
      const minimum = previousEnd + (index ? 0.1 : 0);
      const maximum = Math.max(minimum, sourceDuration - segment.length - remaining);
      const start = clamp(segment.start, minimum, maximum);
      previousEnd = start + segment.length;
      return { ...segment, start };
    });
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

  async function refineSegmentSafety(video, segments, sourceDuration, sourceStart = 0) {
    const width = 96;
    const height = clamp(Math.round(width * (video.videoHeight / video.videoWidth)), 54, 108);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const refined = [];

    for (let index = 0; index < segments.length; index += 1) {
      throwIfCancelled();
      const segment = segments[index];
      if (segment.isOpeningTeaser) {
        refined.push(segment);
        continue;
      }
      let best = null;
      const fastCut = segment.length < 7;
      const shifts = fastCut ? [0, Math.min(0.5, segment.length / 3)] : [0, 3, -3, 6, -6];

      for (const shift of shifts) {
        const start = segment.start + shift;
        const previousEnd = refined.length ? refined[refined.length - 1].start + refined[refined.length - 1].length : 0;
        const nextStart = segments[index + 1]?.start ?? sourceDuration;
        if (start < Math.max(sourceStart, previousEnd + (index ? 0.08 : 0)) || start + segment.length > nextStart - (index + 1 < segments.length ? 0.08 : 0)) continue;
        const candidate = { ...segment, start };
        if (overlapsEarlierSegment(candidate, refined)) continue;

        const risk = await measureVisualRisk(video, context, width, height, candidate, fastCut);
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

  async function measureVisualRisk(video, context, width, height, segment, fastCut = false) {
    const probeRatios = fastCut ? [0.5] : [0.15, 0.5, 0.85];
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

    setProgress(41, "Building your preview", `Preparing ${segments.length} selected moments…`, "Original audio included");

    // Preload three upcoming cuts. Seeking during a 1-second shot must never
    // stall the recorder or leave a frozen frame at the join.
    const prepared = new Array(segments.length);
    await Promise.all(segments.slice(0, videos.length).map((segment, slot) =>
      seekVideo(videos[slot], segment.start)
    ));
    for (let index = 0; index < Math.min(segments.length, videos.length); index += 1) {
      prepared[index] = Promise.resolve(null);
    }
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
    let plannedSeconds = 0;
    const captureStartedAt = performance.now();
    let pausedSince = null;
    let totalPausedMs = 0;
    const captureSeconds = () => {
      const now = performance.now();
      return Math.max(0, (now - captureStartedAt - totalPausedMs - (pausedSince === null ? 0 : now - pausedSince)) / 1000);
    };

    try {
      for (let index = 0; index < segments.length; index += 1) {
        throwIfCancelled();
        const segment = segments[index];
        const activeSlot = index % videos.length;
        const video = videos[activeSlot];
        state.activeVideo = video;

        const preparationError = await prepared[index];
        if (preparationError) throw preparationError;
        setActiveAudioSlot(gainNodes, activeSlot, audioContext);
        const tracker = createCropTracker(segment.focusX, video);
        const renderLength = chooseRenderLength(segment, targetSeconds, completedSeconds,
          plannedSeconds, captureSeconds(), index, segments.length - index);
        const renderSegment = { ...segment, length: renderLength };

        await playAndRenderSegment(video, context, tracker, renderSegment, ({ elapsed }) => {
          const totalRendered = completedSeconds + elapsed;
          const percent = 41 + (totalRendered / targetSeconds) * 57;
          setProgress(
            percent,
            "Building your preview",
            `Rendering highlight ${index + 1} of ${segments.length}…`,
            `${formatDuration(totalRendered)} / ${formatDuration(targetSeconds)}`,
            true
          );
        });
        completedSeconds += renderLength;
        plannedSeconds += segment.length;

        const futureIndex = index + videos.length;
        if (futureIndex < segments.length) {
          prepared[futureIndex] = seekVideo(video, segments[futureIndex].start)
            .then(() => null, (error) => error);
        }

        const nextIndex = index + 1;
        if (nextIndex < segments.length) {
          const nextReady = prepared[nextIndex];
          let isReady = false;
          nextReady.then(() => { isReady = true; });
          await Promise.resolve();
          if (!isReady && recorder.state === "recording" && typeof recorder.pause === "function") {
            recorder.pause();
            pausedSince = performance.now();
          }
          const nextError = await nextReady;
          if (nextError) throw nextError;
          const nextSlot = nextIndex % videos.length;
          const nextVideo = videos[nextSlot];
          setActiveAudioSlot(gainNodes, nextSlot, audioContext);
          const nextTracker = createCropTracker(segments[nextIndex].focusX, nextVideo);
          drawVerticalFrame(nextVideo, context, nextTracker, true);
          if (recorder.state === "paused") {
            recorder.resume();
            if (pausedSince !== null) totalPausedMs += performance.now() - pausedSince;
            pausedSince = null;
          }
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
    const fileName = `${safeBase}-preview-${state.outputMinutes}m.${extension}`;

    return { blob, mimeType, fileName };
  }

  function chooseRenderLength(segment, targetSeconds, completedSeconds, plannedSeconds, capturedSeconds, completedCount, remainingCount) {
    // MediaRecorder captures real time, including the small gaps between ready
    // cuts. Trim those measured gaps gradually from upcoming shots, preserving
    // the visible final result; no browser can promise frame-perfect MP4 length.
    if (remainingCount < 1 || targetSeconds <= 0) return segment.length;
    const observedGap = Math.max(0, capturedSeconds - completedSeconds);
    const averageGap = completedCount >= 6 ? observedGap / completedCount : 0;
    // A negative drift is useful credit from earlier cuts; do not keep
    // shortening later clips once the output is already on time.
    const uncorrectedDrift = capturedSeconds - plannedSeconds;
    const correction = (uncorrectedDrift + averageGap * Math.max(0, remainingCount - 1) + 0.08) / remainingCount;
    const isLast = remainingCount === 1 && segment.isClosing;
    const maximumTrim = isLast
      ? Math.min(0.18, Math.max(0, segment.length - 2.8))
      : Math.min(0.13, Math.max(0.035, segment.length * 0.08));
    return segment.length - clamp(correction, 0, maximumTrim);
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
    const backdrop = document.createElement("canvas");
    backdrop.width = 56;
    backdrop.height = 100;
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
      backdrop,
      backdropContext: backdrop.getContext("2d"),
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
      // Retain more of the action on both sides, and the full frame height.
      // A tightly filled 9:16 crop often cuts off a hand, tool or client.
      cropWidth = Math.min(sourceWidth, sourceHeight * OUTPUT_WIDTH / (OUTPUT_HEIGHT * 0.84));
      sourceX = clamp(tracker.focus * sourceWidth - cropWidth / 2, 0, sourceWidth - cropWidth);
      const displayHeight = Math.min(OUTPUT_HEIGHT, OUTPUT_WIDTH * sourceHeight / cropWidth);
      if (displayHeight < OUTPUT_HEIGHT - 1) {
        drawContextBackdrop(video, context, tracker, sourceX, cropWidth, sourceHeight, forceTrack);
        context.drawImage(video, sourceX, 0, cropWidth, sourceHeight,
          0, (OUTPUT_HEIGHT - displayHeight) / 2, OUTPUT_WIDTH, displayHeight);
        tracker.hasGoodFrame = true;
        return;
      }
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

  function drawContextBackdrop(video, context, tracker, sourceX, cropWidth, sourceHeight, forceTrack) {
    // A tiny cached background fills the narrow bands without processing a
    // second full-resolution video frame on every draw (important on phones).
    if (forceTrack || tracker.frame % 12 === 0) {
      tracker.backdropContext.drawImage(video, sourceX, 0, cropWidth, sourceHeight,
        0, 0, tracker.backdrop.width, tracker.backdrop.height);
    }
    context.drawImage(tracker.backdrop, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    context.fillStyle = "rgba(8, 11, 16, 0.42)";
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
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
        const centerPrior = 0.25 + 0.75 * Math.exp(-Math.pow((x / width - 0.5) / 0.3, 2));
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
      const stableCenter = tracker.initialFocus * 0.3 + 0.5 * 0.7;
      let target = clamp(detected * 0.3 + stableCenter * 0.7, 0.35, 0.65);

      if (tracker.faceFocus !== null && performance.now() - tracker.faceSeenAt < 1300) {
        // Faces give context, but hands, objects and the action itself should
        // drive framing; otherwise the frame follows the presenter alone.
        target = tracker.faceFocus * 0.2 + detected * 0.55 + stableCenter * 0.25;
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
    const skippedOpening = state.skippedPreview
      ? ` • ${state.skipMethod === "manual" ? "start time chosen" : "fast-cut preview skipped"} (${formatDuration(state.skippedPreview)})`
      : "";
    const openingNote = state.usedOpeningTeaser ? " • built-in fast opening kept" : "";
    ui.resultMeta.textContent = `${state.outputMinutes}-minute fast-cut preview • ${segments.length} selected sections${openingNote}${skippedOpening} • ${formatBytes(result.blob.size)} • ${result.mimeType.includes("mp4") ? "MP4" : "WebM"}`;
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
    ui.useOpeningTeaser.disabled = locked;
    ui.openingStart.disabled = locked;
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
