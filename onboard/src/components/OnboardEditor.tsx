import { type ChangeEvent, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { ArrowDownUp, Check, ChevronDown, Copy, Crop, Download, Link2, List, Pause, Play, RefreshCw, RotateCw, Scissors, Trash2, Upload, X } from 'lucide-react';
import { exportGif as exportGifLocally, exportMp4 as exportMp4Locally } from '../lib/editor';
import { MAX_EXPORT_BYTES } from '../lib/exportSizing';
import { getPlaybackTransition } from '../lib/playback';
import { buildPreviewTransferTable, getEditedDuration, isIncreaseOnlyAdjustment, isTimeInSegments, preflightExport, validateSourceDimensions } from '../lib/recipe';
import { fetchRemoteMp4, formatByteCount, parseRemoteMp4Url, type RemoteSourceProgress } from '../lib/remoteSource';
import type { VideoEditRecipe } from '../types';

const MIN_CROP_SIZE = 0.05;
const DEFAULT_FRAME_DURATION = 1 / 30;
const ARROW_SCRUB_HOLD_DELAY_MS = 1000;
const PLAYBACK_RATE_MIN = 0.5;
const PLAYBACK_RATE_MAX = 2;
const PLAYBACK_RATE_STEP = 0.1;
const PLAYBACK_RATE_TICKS = Array.from({ length: 16 }, (_, index) => Number((PLAYBACK_RATE_MIN + index * PLAYBACK_RATE_STEP).toFixed(1)));
const ROTATIONS = [0, 90, 180, 270] as const;
const CROP_PRESETS = [
  ['1:1', 1],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
] as const;
const ADJUSTMENTS = [
  ['exposure', 'Exposure'],
  ['brilliance', 'Brilliance'],
  ['highlights', 'Highlights'],
  ['shadows', 'Shadows'],
  ['contrast', 'Contrast'],
  ['brightness', 'Brightness'],
  ['saturation', 'Saturation'],
  ['vibrance', 'Vibrance'],
  ['sharpness', 'Sharpness'],
  ['definition', 'Definition'],
  ['clarity', 'Clarity'],
  ['denoise', 'Denoise'],
] as const;

type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type CropRect = VideoEditRecipe['crop'];
type VideoSegment = VideoEditRecipe['segments'][number];
type RemoteSourceProgressState = RemoteSourceProgress & { fileName: string };
type EditorSnapshot = {
  segments: VideoSegment[];
  selectedSegmentIndex: number;
  rotation: VideoEditRecipe['rotation'];
  crop: CropRect;
  cropAspectRatio: number | null;
  adjustments: Record<string, number>;
};
type SavedLook = {
  id: string;
  time: number;
  thumbnail: string;
  adjustments: Record<string, number>;
};
type ExportJob = {
  id: string;
  file: File;
  recipe: VideoEditRecipe;
  duration: number;
  width: number;
  height: number;
  format: 'gif' | 'mp4';
  fileName: string;
  status: 'queued' | 'exporting' | 'error';
  progress: number;
  error?: string;
  dismissed?: boolean;
};

export function OnboardEditor() {
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const timelineTrackRef = useRef<HTMLDivElement>(null);
  const exportControllers = useRef(new Map<string, AbortController>());
  const exportQueueRunning = useRef(false);
  const exportJobsRef = useRef<ExportJob[]>([]);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const remoteImportController = useRef<AbortController | null>(null);
  const dragRef = useRef<{
    handle: CropHandle;
    crop: CropRect;
    rect: DOMRect;
    startX: number;
    startY: number;
  } | null>(null);
  const frameDurationRef = useRef(DEFAULT_FRAME_DURATION);
  const pendingPlaybackTransitionRef = useRef<{ resume: boolean } | null>(null);
  const globalKeyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const arrowScrubRef = useRef<{
    direction: -1 | 1;
    frameId: number | null;
    holdTimeoutId: number | null;
  } | null>(null);
  const timelineSeekFrameRef = useRef<number | null>(null);
  const pendingTimelineSeekRef = useRef<{ time: number; isBoundaryPreview: boolean } | null>(null);
  const initialFrameReadyRef = useRef(false);
  const trimPreviewTimeoutRef = useRef<number | null>(null);
  const savedLookClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoHistoryRef = useRef<EditorSnapshot[]>([]);
  const redoHistoryRef = useRef<EditorSnapshot[]>([]);
  const editGestureRef = useRef(false);
  const pendingEditSnapshotRef = useRef<EditorSnapshot | null>(null);
  const timelineDragRef = useRef<
    | { type: 'scrub' }
    | { type: 'trim'; index: number; edge: 'startTime' | 'endTime'; segments: VideoSegment[]; rect: DOMRect; pointerX: number; restoreTime: number }
    | null
  >(null);
  const [file, setFile] = useState<File | null>(null);
  const [mediaName, setMediaName] = useState('');
  const [hasRenamedMedia, setHasRenamedMedia] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [exportFormat, setExportFormat] = useState<'gif' | 'mp4'>('gif');
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [duration, setDuration] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [timelineTrackSize, setTimelineTrackSize] = useState({ width: 0, height: 0 });
  const [timelineFrames, setTimelineFrames] = useState<string[]>([]);
  const [sourceDimensionsValid, setSourceDimensionsValid] = useState(false);
  const [videoFrameStyle, setVideoFrameStyle] = useState<CSSProperties>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showCutTooltip, setShowCutTooltip] = useState(false);
  const [cropOverlayVisible, setCropOverlayVisible] = useState(true);
  const [playheadHiddenAfterTrim, setPlayheadHiddenAfterTrim] = useState(false);
  const playheadHiddenAfterTrimRef = useRef(false);
  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 });
  const [cropAspectRatio, setCropAspectRatio] = useState<number | null>(null);
  const [adjustments, setAdjustments] = useState<Record<string, number>>(
    Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0])),
  );
  const [savedLooks, setSavedLooks] = useState<SavedLook[]>([]);
  const [savedLooksVisible, setSavedLooksVisible] = useState(false);
  const [savingLook, setSavingLook] = useState(false);
  const [activeSavedLookId, setActiveSavedLookId] = useState<string | null>(null);
  const [deletingSavedLookId, setDeletingSavedLookId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [remoteSourceProgress, setRemoteSourceProgress] = useState<RemoteSourceProgressState | null>(null);
  const [remoteSourceHandoff] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('source'));
  const [remoteSourceUrl, setRemoteSourceUrl] = useState('');
  const [showRemoteSourceInput, setShowRemoteSourceInput] = useState(false);
  const editedDuration = getEditedDuration(segments);

  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewUrl) return;
    let callbackId = 0;
    let previousFrame: { mediaTime: number; presentedFrames: number } | null = null;
    const observeFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (previousFrame) {
        const presentedFrames = metadata.presentedFrames - previousFrame.presentedFrames;
        const duration = (metadata.mediaTime - previousFrame.mediaTime) / presentedFrames;
        if (presentedFrames > 0 && duration >= 1 / 240 && duration <= 0.1) {
          frameDurationRef.current = duration;
        }
      }
      previousFrame = { mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames };
      if (!video.paused && !playheadHiddenAfterTrimRef.current && !pendingPlaybackTransitionRef.current) {
        const currentSegments = segmentsRef.current;
        const transition = getPlaybackTransition(
          metadata.mediaTime,
          frameDurationRef.current,
          currentSegments,
        );
        if (transition?.type === 'rate') {
          if (video.playbackRate !== transition.playbackRate) {
            video.playbackRate = transition.playbackRate;
          }
        } else if (transition?.type === 'seek') {
          pendingPlaybackTransitionRef.current = { resume: !video.paused };
          video.playbackRate = transition.playbackRate;
          video.currentTime = transition.time;
          setSelectedSegmentIndex(transition.segmentIndex);
          setCurrentTime(transition.time);
        }
      }
      callbackId = video.requestVideoFrameCallback(observeFrame);
    };
    callbackId = video.requestVideoFrameCallback(observeFrame);
    return () => video.cancelVideoFrameCallback(callbackId);
  }, [previewUrl]);

  useEffect(() => () => {
    exportControllers.current.forEach((controller) => controller.abort());
  }, []);

  useEffect(() => () => remoteImportController.current?.abort(), []);

  useEffect(() => () => {
    if (trimPreviewTimeoutRef.current !== null) {
      window.clearTimeout(trimPreviewTimeoutRef.current);
    }
    if (timelineSeekFrameRef.current !== null) {
      window.cancelAnimationFrame(timelineSeekFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const closeOnOutsideClick = (event: Event) => {
      if (event.target instanceof Node && !exportMenuRef.current?.contains(event.target)) {
        setExportMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [exportMenuOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dimensions.width || !dimensions.height) return;
    const updateFrame = () => {
      const bounds = canvas.getBoundingClientRect();
      const frameWidth = (rotation % 180 ? dimensions.height : dimensions.width)
        * (cropOverlayVisible ? 1 : crop.width);
      const frameHeight = (rotation % 180 ? dimensions.width : dimensions.height)
        * (cropOverlayVisible ? 1 : crop.height);
      const scale = Math.min(bounds.width / frameWidth, bounds.height / frameHeight);
      const width = frameWidth * scale;
      const height = frameHeight * scale;
      setVideoFrameStyle({
        left: `${((bounds.width - width) / 2 / bounds.width) * 100}%`,
        top: `${((bounds.height - height) / 2 / bounds.height) * 100}%`,
        width: `${(width / bounds.width) * 100}%`,
        height: `${(height / bounds.height) * 100}%`,
      });
    };
    const observer = new ResizeObserver(updateFrame);
    observer.observe(canvas);
    updateFrame();
    return () => observer.disconnect();
  }, [crop, cropOverlayVisible, dimensions, rotation]);

  useEffect(() => {
    const track = timelineTrackRef.current;
    if (!track) return;
    const updateSize = () => {
      const { width, height } = track.getBoundingClientRect();
      setTimelineTrackSize((current) => (
        current.width === width && current.height === height ? current : { width, height }
      ));
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(track);
    updateSize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setTimelineFrames([]);
    if (!previewUrl || !duration || !dimensions.width || !dimensions.height || !timelineTrackSize.width || !timelineTrackSize.height) return;
    const controller = new AbortController();
    const displayAspect = (rotation % 180 ? dimensions.height : dimensions.width)
      * crop.width
      / ((rotation % 180 ? dimensions.width : dimensions.height) * crop.height);
    const frameCount = Math.max(1, Math.ceil(timelineTrackSize.width / (timelineTrackSize.height * displayAspect)));
    const thumbnailVideo = document.createElement('video');
    thumbnailVideo.muted = true;
    thumbnailVideo.preload = 'auto';
    thumbnailVideo.src = previewUrl;
    thumbnailVideo.load();

    void (async () => {
      try {
        await waitForMediaEvent(thumbnailVideo, 'loadedmetadata', controller.signal);
        const frames: string[] = [];
        for (let index = 0; index < frameCount; index += 1) {
          if (controller.signal.aborted) return;
          const time = duration * ((index + 0.5) / frameCount);
          await seekForTimelineFrame(thumbnailVideo, time, controller.signal);
          frames.push(createTimelineThumbnail(thumbnailVideo, crop, rotation));
          setTimelineFrames([...frames]);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError('Could not create timeline frame previews for this video.');
        }
      } finally {
        thumbnailVideo.pause();
        thumbnailVideo.removeAttribute('src');
        thumbnailVideo.load();
      }
    })();

    return () => controller.abort();
  }, [crop, dimensions, duration, previewUrl, rotation, timelineTrackSize]);

  function chooseVideo(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    remoteImportController.current?.abort();
    remoteImportController.current = null;
    setRemoteSourceProgress(null);
    loadVideo(nextFile);
  }

  function getEditSnapshot(): EditorSnapshot {
    return {
      segments: segments.map((segment) => ({ ...segment })),
      selectedSegmentIndex,
      rotation,
      crop: { ...crop },
      cropAspectRatio,
      adjustments: { ...adjustments },
    };
  }

  function pushUndoSnapshot(snapshot: EditorSnapshot) {
    undoHistoryRef.current.push(snapshot);
    if (undoHistoryRef.current.length > 100) undoHistoryRef.current.shift();
  }

  function updateExportJobs(update: (current: ExportJob[]) => ExportJob[]) {
    const next = update(exportJobsRef.current);
    exportJobsRef.current = next;
    setExportJobs(next);
  }

  function beginEditGesture() {
    if (editGestureRef.current) return;
    editGestureRef.current = true;
    pendingEditSnapshotRef.current = getEditSnapshot();
  }

  function finishEditGesture() {
    editGestureRef.current = false;
    pendingEditSnapshotRef.current = null;
  }

  function recordEdit() {
    clearTrimPreview();
    setActiveSavedLookId(null);
    if (editGestureRef.current) {
      if (pendingEditSnapshotRef.current) {
        pushUndoSnapshot(pendingEditSnapshotRef.current);
        pendingEditSnapshotRef.current = null;
      }
    } else {
      pushUndoSnapshot(getEditSnapshot());
    }
    redoHistoryRef.current = [];
  }

  function applyEditSnapshot(snapshot: EditorSnapshot) {
    const restoredSegments = snapshot.segments.map((segment) => ({ ...segment }));
    const nextSelectedIndex = clamp(snapshot.selectedSegmentIndex, 0, Math.max(0, restoredSegments.length - 1));
    const nextTime = isTimeInSegments(currentTime, restoredSegments)
      ? currentTime
      : restoredSegments[0]?.startTime ?? 0;
    clearTrimPreview();
    videoRef.current?.pause();
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
      videoRef.current.playbackRate = restoredSegments[nextSelectedIndex]?.playbackRate ?? 1;
    }
    setPlaying(false);
    setSegments(restoredSegments);
    setSelectedSegmentIndex(nextSelectedIndex);
    setRotation(snapshot.rotation);
    setCrop({ ...snapshot.crop });
    setCropAspectRatio(snapshot.cropAspectRatio);
    setAdjustments({ ...snapshot.adjustments });
    setCurrentTime(nextTime);
    playheadHiddenAfterTrimRef.current = false;
    setPlayheadHiddenAfterTrim(false);
    setShowCutTooltip(false);
    setActiveSavedLookId(null);
  }

  function undoEdit() {
    const previous = undoHistoryRef.current.pop();
    if (!previous) return;
    redoHistoryRef.current.push(getEditSnapshot());
    applyEditSnapshot(previous);
  }

  function redoEdit() {
    const next = redoHistoryRef.current.pop();
    if (!next) return;
    pushUndoSnapshot(getEditSnapshot());
    applyEditSnapshot(next);
  }

  function clearTrimPreview() {
    if (trimPreviewTimeoutRef.current !== null) {
      window.clearTimeout(trimPreviewTimeoutRef.current);
      trimPreviewTimeoutRef.current = null;
    }
  }

  function scheduleTrimPreviewRestore(restoreTime: number) {
    clearTrimPreview();
    trimPreviewTimeoutRef.current = window.setTimeout(() => {
      trimPreviewTimeoutRef.current = null;
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = clamp(restoreTime, 0, duration);
      setCurrentTime(video.currentTime);
    }, 650);
  }

  function previewTimelineBoundary(time: number) {
    scheduleTimelineSeek(clamp(time, 0, duration), true);
  }

  function showTrimPreviewFrame(previewTime: number, restoreTime: number) {
    const video = videoRef.current;
    if (!video) return;
    clearTrimPreview();
    video.pause();
    video.currentTime = clamp(previewTime, 0, duration);
    setCurrentTime(video.currentTime);
    scheduleTrimPreviewRestore(restoreTime);
  }

  function loadVideo(nextFile?: File) {
    clearTrimPreview();
    undoHistoryRef.current = [];
    redoHistoryRef.current = [];
    finishEditGesture();
    setError('');
    setDuration(0);
    setSegments([]);
    setCurrentTime(0);
    setCropOverlayVisible(true);
    setPlayheadHiddenAfterTrim(false);
    playheadHiddenAfterTrimRef.current = false;
    setDimensions({ width: 0, height: 0 });
    setSourceDimensionsValid(false);
    setActiveSavedLookId(null);
    if (!nextFile) return;
    if (!nextFile.name.toLowerCase().endsWith('.mp4') && nextFile.type !== 'video/mp4') {
      setError('Choose an MP4 video.');
      return;
    }
    initialFrameReadyRef.current = false;
    setFile(nextFile);
    setMediaName(nextFile.name);
    setHasRenamedMedia(false);
    setIsRenaming(false);
    frameDurationRef.current = DEFAULT_FRAME_DURATION;
    setRotation(0);
    setCrop({ x: 0, y: 0, width: 1, height: 1 });
    setCropAspectRatio(null);
    setAdjustments(Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0])));
  }

  function importRemoteSource(value: string) {
    let sourceUrl: URL;
    try {
      sourceUrl = parseRemoteMp4Url(value.trim());
    } catch (sourceError) {
      setError(sourceError instanceof Error ? sourceError.message : 'The video source URL is invalid.');
      return;
    }

    remoteImportController.current?.abort();
    const controller = new AbortController();
    remoteImportController.current = controller;
    const pathName = sourceUrl.pathname.split('/').filter(Boolean).at(-1) || 'video.mp4';
    setError('');
    setRemoteSourceProgress({ fileName: pathName, loaded: 0, total: null });

    void fetchRemoteMp4(sourceUrl, (progress) => {
      if (remoteImportController.current === controller) {
        setRemoteSourceProgress({ ...progress, fileName: pathName });
      }
    }, controller.signal)
      .then((sourceFile) => {
        if (remoteImportController.current !== controller) return;
        remoteImportController.current = null;
        setRemoteSourceProgress(null);
        setRemoteSourceUrl('');
        setShowRemoteSourceInput(false);
        loadVideo(sourceFile);
      })
      .catch((sourceError: unknown) => {
        if (remoteImportController.current !== controller || (sourceError instanceof DOMException && sourceError.name === 'AbortError')) return;
        remoteImportController.current = null;
        setRemoteSourceProgress(null);
        setError(`${sourceError instanceof Error ? sourceError.message : 'Could not load this video.'} Use Choose MP4 or drop a file instead.`);
      });
  }

  useEffect(() => {
    if (remoteSourceHandoff === null) return;
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    importRemoteSource(remoteSourceHandoff);
  }, [remoteSourceHandoff]);

  function beginRename() {
    if (!file) return;
    setRenameDraft(mediaName.replace(/\.[^.]+$/, ''));
    setIsRenaming(true);
  }

  function finishRename() {
    if (!file) return;
    const baseName = renameDraft.replace(/\s+/g, '-') || 'video';
    setMediaName(`${baseName}.${exportFormat}`);
    setHasRenamedMedia(true);
    setIsRenaming(false);
  }

  function chooseExportFormat(format: 'gif' | 'mp4') {
    setExportFormat(format);
    if (hasRenamedMedia) {
      setMediaName((current) => `${current.replace(/\.[^.]+$/, '')}.${format}`);
    }
    setExportMenuOpen(false);
  }

  function cropForAspectRatio(aspectRatio: number, nextRotation = rotation): CropRect {
    const frameAspectRatio = nextRotation % 180
      ? dimensions.height / dimensions.width
      : dimensions.width / dimensions.height;
    if (frameAspectRatio > aspectRatio) {
      const width = aspectRatio / frameAspectRatio;
      return { x: (1 - width) / 2, y: 0, width, height: 1 };
    }
    const height = frameAspectRatio / aspectRatio;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }

  function setCropAspect(aspectRatio: number) {
    if (!dimensions.width || !dimensions.height) return;
    recordEdit();
    setCropAspectRatio(aspectRatio);
    setCrop(cropForAspectRatio(aspectRatio));
    setCropOverlayVisible(true);
  }

  function invertCropAspect() {
    if (cropAspectRatio === null || cropAspectRatio === 1) return;
    const invertedAspectRatio = 1 / cropAspectRatio;
    recordEdit();
    setCropAspectRatio(invertedAspectRatio);
    setCrop(cropForAspectRatio(invertedAspectRatio));
    setCropOverlayVisible(true);
  }

  function rotateVideo() {
    const nextRotation = ROTATIONS[(ROTATIONS.indexOf(rotation) + 1) % ROTATIONS.length];
    recordEdit();
    setRotation(nextRotation);
    if (cropAspectRatio !== null && dimensions.width && dimensions.height) {
      setCrop(cropForAspectRatio(cropAspectRatio, nextRotation));
    }
  }

  function dropVideo(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingFile(false);
    remoteImportController.current?.abort();
    remoteImportController.current = null;
    setRemoteSourceProgress(null);
    loadVideo(event.dataTransfer.files[0]);
  }

  function onMetadata() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      setError('Could not read this video’s duration. Try another MP4.');
      return;
    }
    setDuration(video.duration);
    setSegments([{ startTime: 0, endTime: video.duration, playbackRate: 1 }]);
    setSelectedSegmentIndex(0);
    setCurrentTime(0);
    setDimensions({ width: video.videoWidth, height: video.videoHeight });
    try {
      validateSourceDimensions(video.videoWidth, video.videoHeight);
      setSourceDimensionsValid(true);
    } catch (dimensionError) {
      setSourceDimensionsValid(false);
      setError(dimensionError instanceof Error ? dimensionError.message : 'Video dimensions are not supported.');
    }
  }

  function onVideoDataReady() {
    const video = videoRef.current;
    if (!video || initialFrameReadyRef.current) return;
    initialFrameReadyRef.current = true;
    video.pause();
    video.currentTime = segments[0]?.startTime ?? 0;
  }

  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video || playheadHiddenAfterTrimRef.current) return;
    const time = video.currentTime;
    const segmentIndex = segments.findIndex((segment) => (
      time >= segment.startTime && time < segment.endTime
    ));
    if (segmentIndex >= 0) {
      if (segmentIndex !== selectedSegmentIndex) setSelectedSegmentIndex(segmentIndex);
      if (video.playbackRate !== segments[segmentIndex].playbackRate) {
        video.playbackRate = segments[segmentIndex].playbackRate;
      }
    }
    setCurrentTime(time);
  }

  function onVideoSeeked() {
    const video = videoRef.current;
    const transition = pendingPlaybackTransitionRef.current;
    if (!video || !transition) return;
    pendingPlaybackTransitionRef.current = null;
    if (!transition.resume) return;
    if (!video.paused) {
      setPlaying(true);
      return;
    }
    void video.play().then(() => {
      setPlaying(true);
    }).catch(() => {
      setPlaying(false);
      setError('Could not continue playing this video in the browser.');
    });
  }

  function onVideoPause() {
    if (pendingPlaybackTransitionRef.current?.resume) return;
    setPlaying(false);
  }

  function onVideoEnded() {
    const video = videoRef.current;
    const firstSegment = segments[0];
    if (!video || !firstSegment) {
      setPlaying(false);
      return;
    }
    video.currentTime = firstSegment.startTime;
    video.playbackRate = firstSegment.playbackRate;
    setSelectedSegmentIndex(0);
    setCurrentTime(firstSegment.startTime);
    void video.play().catch(() => {
      setPlaying(false);
      setError('Could not continue playing this video in the browser.');
    });
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    clearTrimPreview();
    if (video.paused) {
      if (playheadHiddenAfterTrim) {
        const firstSegment = segments[0];
        if (!firstSegment) return;
        video.currentTime = firstSegment.startTime;
        setCurrentTime(firstSegment.startTime);
      } else {
        const currentSegment = segments.find((segment) => video.currentTime >= segment.startTime && video.currentTime < segment.endTime);
        if (!currentSegment) video.currentTime = segments.find((segment) => segment.startTime > video.currentTime)?.startTime ?? segments[0]?.startTime ?? 0;
      }
      const activeSegment = segments.find((segment) => video.currentTime >= segment.startTime && video.currentTime < segment.endTime);
      if (activeSegment) video.playbackRate = activeSegment.playbackRate;
      try {
        await video.play();
        playheadHiddenAfterTrimRef.current = false;
        setPlayheadHiddenAfterTrim(false);
        setPlaying(true);
      } catch {
        setError('Could not play this video in the browser.');
      }
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function seekVideo(value: number) {
    const video = videoRef.current;
    if (!video) return;
    clearTrimPreview();
    const containingSegment = segments.find((segment) => value >= segment.startTime && value < segment.endTime);
    const nextSegment = segments.find((segment) => segment.startTime > value);
    const resolvedTime = containingSegment
      ? value
      : nextSegment?.startTime ?? segments[segments.length - 1]?.endTime ?? 0;
    video.currentTime = resolvedTime;
    const activeIndex = segments.findIndex((segment) => resolvedTime >= segment.startTime && resolvedTime < segment.endTime);
    if (activeIndex >= 0) {
      video.playbackRate = segments[activeIndex].playbackRate;
      setSelectedSegmentIndex(activeIndex);
    }
    setCurrentTime(resolvedTime);
  }

  function flushTimelineSeek() {
    if (timelineSeekFrameRef.current !== null) {
      window.cancelAnimationFrame(timelineSeekFrameRef.current);
      timelineSeekFrameRef.current = null;
    }
    const pendingSeek = pendingTimelineSeekRef.current;
    pendingTimelineSeekRef.current = null;
    if (!pendingSeek) return;
    if (pendingSeek.isBoundaryPreview) {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = clamp(pendingSeek.time, 0, duration);
      setCurrentTime(video.currentTime);
    } else {
      seekVideo(pendingSeek.time);
    }
  }

  function previewTimelineTime(value: number) {
    scheduleTimelineSeek(value, false);
  }

  function scheduleTimelineSeek(time: number, isBoundaryPreview: boolean) {
    pendingTimelineSeekRef.current = { time, isBoundaryPreview };
    if (timelineSeekFrameRef.current !== null) return;
    timelineSeekFrameRef.current = window.requestAnimationFrame(() => {
      timelineSeekFrameRef.current = null;
      const pendingSeek = pendingTimelineSeekRef.current;
      pendingTimelineSeekRef.current = null;
      if (!pendingSeek) return;
      if (pendingSeek.isBoundaryPreview) {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = clamp(pendingSeek.time, 0, duration);
        setCurrentTime(video.currentTime);
      } else {
        seekVideo(pendingSeek.time);
      }
    });
  }

  function scrubByFrame(direction: -1 | 1) {
    if (!segments.length) return;
    const video = videoRef.current;
    const frameDuration = frameDurationRef.current;

    if (playheadHiddenAfterTrimRef.current) {
      const selected = segments[selectedSegmentIndex] ?? segments[0];
      if (!selected) return;
      const target = direction < 0
        ? Math.max(selected.startTime, selected.endTime - frameDuration)
        : selected.startTime;
      playheadHiddenAfterTrimRef.current = false;
      setPlayheadHiddenAfterTrim(false);
      video?.pause();
      seekVideo(target);
      setShowCutTooltip(false);
      return;
    }

    const time = video?.currentTime ?? currentTime;
    let activeIndex = segments.findIndex((segment) => time >= segment.startTime && time < segment.endTime);
    if (activeIndex < 0) {
      activeIndex = selectedSegmentIndex;
    }
    const active = segments[activeIndex];
    if (!active) return;

    let target: number;
    if (direction < 0) {
      if (time - frameDuration >= active.startTime) {
        target = time - frameDuration;
      } else {
        const previous = segments[activeIndex - 1];
        target = previous
          ? Math.max(previous.startTime, previous.endTime - frameDuration)
          : active.startTime;
      }
    } else if (time + frameDuration < active.endTime) {
      target = time + frameDuration;
    } else {
      const next = segments[activeIndex + 1];
      target = next ? next.startTime : Math.max(active.startTime, active.endTime - frameDuration);
    }

    video?.pause();
    seekVideo(target);
    setShowCutTooltip(false);
  }

  function getTimelineTime(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return 0;
    return clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * duration;
  }

  function onTimelinePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!duration) return;
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-edge]') : null;
    const edge = target?.dataset.edge as 'startTime' | 'endTime' | undefined;
    const segmentIndex = Number(target?.dataset.segmentIndex);
    if (edge && Number.isInteger(segmentIndex) && segments[segmentIndex]) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      beginEditGesture();
      timelineDragRef.current = {
        type: 'trim',
        index: segmentIndex,
        edge,
        segments: segments.map((segment) => ({ ...segment })),
        rect: event.currentTarget.getBoundingClientRect(),
        pointerX: event.clientX,
        restoreTime: currentTime,
      };
      setSelectedSegmentIndex(segmentIndex);
      videoRef.current?.pause();
      clearTrimPreview();
      setShowCutTooltip(false);
      return;
    }
    const time = getTimelineTime(event);
    if (!isTimeInSegments(time, segments)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    timelineDragRef.current = { type: 'scrub' };
    playheadHiddenAfterTrimRef.current = false;
    setPlayheadHiddenAfterTrim(false);
    event.currentTarget.focus({ preventScroll: true });
    videoRef.current?.pause();
    setShowCutTooltip(false);
    seekVideo(time);
  }

  function onTimelineDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!duration || playheadHiddenAfterTrim) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const playheadX = bounds.left + (currentTime / duration) * bounds.width;
    if (Math.abs(event.clientX - playheadX) > 8) return;
    event.preventDefault();
    setShowCutTooltip(true);
  }

  function onTimelinePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = timelineDragRef.current;
    if (!drag) return;
    if (drag.type === 'scrub') {
      previewTimelineTime(getTimelineTime(event));
      return;
    }
    const index = drag.index;
    const segment = drag.segments[index];
    const delta = ((event.clientX - drag.pointerX) / drag.rect.width) * duration;
    const updated = drag.segments.map((item) => ({ ...item }));
    if (drag.edge === 'startTime') {
      const lowerBound = index > 0 ? drag.segments[index - 1].endTime : 0;
      updated[index].startTime = clamp(segment.startTime + delta, lowerBound, segment.endTime - 0.001);
    } else {
      const upperBound = index < drag.segments.length - 1 ? drag.segments[index + 1].startTime : duration;
      updated[index].endTime = clamp(segment.endTime + delta, segment.startTime + 0.001, upperBound);
    }
    const playheadRemainsInKeptVideo = isTimeInSegments(currentTime, updated);
    const changed = updated.some((item, itemIndex) => (
      item.startTime !== segments[itemIndex].startTime || item.endTime !== segments[itemIndex].endTime
    ));
    if (changed) recordEdit();
    if (!playheadRemainsInKeptVideo && !playheadHiddenAfterTrim) {
      playheadHiddenAfterTrimRef.current = true;
      setPlayheadHiddenAfterTrim(true);
      videoRef.current?.pause();
    } else if (playheadRemainsInKeptVideo && playheadHiddenAfterTrim) {
      playheadHiddenAfterTrimRef.current = false;
      setPlayheadHiddenAfterTrim(false);
    }
    setSegments(updated);
    const previewTime = drag.edge === 'startTime'
      ? updated[index].startTime
      : Math.max(updated[index].startTime, updated[index].endTime - frameDurationRef.current);
    previewTimelineBoundary(previewTime);
  }

  function onTimelinePointerUp() {
    const drag = timelineDragRef.current;
    if (drag?.type === 'trim') {
      flushTimelineSeek();
      const changed = drag.segments.some((segment, index) => (
        segment.startTime !== segments[index]?.startTime || segment.endTime !== segments[index]?.endTime
      ));
      if (changed) scheduleTrimPreviewRestore(drag.restoreTime);
    } else if (drag?.type === 'scrub') {
      flushTimelineSeek();
    }
    timelineDragRef.current = null;
    finishEditGesture();
  }

  function onTrimHandleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(event.currentTarget.dataset.segmentIndex);
    const edge = event.currentTarget.dataset.edge as 'startTime' | 'endTime' | undefined;
    const segment = segments[index];
    if (!edge || !segment) return;
    const delta = event.key === 'ArrowLeft' ? -0.25 : 0.25;
    const updated = segments.map((item) => ({ ...item }));
    if (edge === 'startTime') {
      const lowerBound = index > 0 ? segments[index - 1].endTime : 0;
      updated[index].startTime = clamp(segment.startTime + delta, lowerBound, segment.endTime - 0.001);
    } else {
      const upperBound = index < segments.length - 1 ? segments[index + 1].startTime : duration;
      updated[index].endTime = clamp(segment.endTime + delta, segment.startTime + 0.001, upperBound);
    }
    const changed = updated[index].startTime !== segment.startTime || updated[index].endTime !== segment.endTime;
    if (changed) recordEdit();
    setSegments(updated);
    setSelectedSegmentIndex(index);
    setShowCutTooltip(false);
    if (isTimeInSegments(currentTime, updated)) {
      playheadHiddenAfterTrimRef.current = false;
      setPlayheadHiddenAfterTrim(false);
    } else {
      playheadHiddenAfterTrimRef.current = true;
      setPlayheadHiddenAfterTrim(true);
    }
    if (changed) {
      const previewTime = edge === 'startTime'
        ? updated[index].startTime
        : Math.max(updated[index].startTime, updated[index].endTime - frameDurationRef.current);
      showTrimPreviewFrame(previewTime, currentTime);
    }
  }

  function cutAtTime(time: number) {
    const index = getSegmentIndexAtCutTime(time);
    if (index < 0) return;
    recordEdit();
    setShowCutTooltip(false);
    const selected = segments[index];
    const next = [
      ...segments.slice(0, index),
      { ...selected, endTime: time },
      { ...selected, startTime: time },
      ...segments.slice(index + 1),
    ];
    setSegments(next);
    setSelectedSegmentIndex(index + 1);
    if (videoRef.current) videoRef.current.currentTime = time;
    setCurrentTime(time);
  }

  function canCutAtTime(time: number) {
    return getSegmentIndexAtCutTime(time) >= 0;
  }

  function getSegmentIndexAtCutTime(time: number) {
    return segments.findIndex((segment) => time - segment.startTime >= 0.001 && segment.endTime - time >= 0.001);
  }

  function removeSelectedSegment() {
    const activeIndex = segments.findIndex((segment) => isTimeInSegments(currentTime, [segment]));
    const targetIndex = activeIndex >= 0 ? activeIndex : selectedSegmentIndex;
    if (segments.length <= 1 || !segments[targetIndex]) return;
    recordEdit();
    const next = segments.filter((_, index) => index !== targetIndex);
    const nextIndex = Math.min(targetIndex, next.length - 1);
    setSegments(next);
    setSelectedSegmentIndex(nextIndex);
    const nextTime = next[nextIndex].startTime;
    playheadHiddenAfterTrimRef.current = false;
    setPlayheadHiddenAfterTrim(false);
    setShowCutTooltip(false);
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
      videoRef.current.playbackRate = next[nextIndex].playbackRate;
    }
    setCurrentTime(nextTime);
  }

  function selectedSegment() {
    const activeIndex = segments.findIndex((segment) => isTimeInSegments(currentTime, [segment]));
    return segments[activeIndex >= 0 ? activeIndex : selectedSegmentIndex];
  }

  function setSelectedSegmentSpeed(playbackRate: number) {
    const segment = selectedSegment();
    if (!segment) return;
    if (segment.playbackRate === playbackRate) return;
    const activeIndex = segments.findIndex((item) => item === segment);
    if (activeIndex < 0) return;
    recordEdit();
    setSegments((current) => current.map((segment, index) => (
      index === activeIndex ? { ...segment, playbackRate } : segment
    )));
    if (videoRef.current && currentTime >= segment.startTime && currentTime < segment.endTime) {
      videoRef.current.playbackRate = playbackRate;
    }
  }

  function selectSegment(index: number) {
    if (segments.length <= 1 || !segments[index]) return;
    setSelectedSegmentIndex(index);
  }

  function seekArrowScrub(value: number, direction: -1 | 1) {
    const video = videoRef.current;
    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1];
    if (!video || !firstSegment || !lastSegment) return;

    const minimum = firstSegment.startTime;
    const maximum = Math.max(minimum, lastSegment.endTime - frameDurationRef.current);
    const requestedTime = clamp(value, minimum, maximum);
    const containingSegment = segments.find((segment) => (
      requestedTime >= segment.startTime && requestedTime < segment.endTime
    ));
    const previousSegment = [...segments].reverse().find((segment) => segment.endTime <= requestedTime);
    const nextSegment = segments.find((segment) => segment.startTime > requestedTime);
    const resolvedTime = containingSegment
      ? requestedTime
      : direction > 0
        ? nextSegment?.startTime ?? maximum
        : previousSegment
          ? Math.max(previousSegment.startTime, previousSegment.endTime - frameDurationRef.current)
          : minimum;
    video.currentTime = resolvedTime;
    const activeIndex = segments.findIndex((segment) => (
      resolvedTime >= segment.startTime && resolvedTime < segment.endTime
    ));
    if (activeIndex >= 0) {
      video.playbackRate = segments[activeIndex].playbackRate;
      setSelectedSegmentIndex(activeIndex);
    }
    setCurrentTime(resolvedTime);
  }

  function stopArrowScrub() {
    const activeScrub = arrowScrubRef.current;
    if (!activeScrub) return;
    if (activeScrub.holdTimeoutId !== null) window.clearTimeout(activeScrub.holdTimeoutId);
    if (activeScrub.frameId !== null) window.cancelAnimationFrame(activeScrub.frameId);
    arrowScrubRef.current = null;
  }

  function startArrowScrub(direction: -1 | 1) {
    if (arrowScrubRef.current?.direction === direction) return;
    stopArrowScrub();
    const video = videoRef.current;
    if (!video) return;
    clearTrimPreview();
    video.pause();
    scrubByFrame(direction);

    const activeScrub = {
      direction,
      frameId: null as number | null,
      holdTimeoutId: null as number | null,
    };
    arrowScrubRef.current = activeScrub;
    activeScrub.holdTimeoutId = window.setTimeout(() => {
      if (arrowScrubRef.current !== activeScrub) return;
      activeScrub.holdTimeoutId = null;
      let previousTimestamp: number | null = null;
      const advance = (timestamp: number) => {
        const currentVideo = videoRef.current;
        if (arrowScrubRef.current !== activeScrub || !currentVideo) return;
        if (previousTimestamp !== null) {
          const elapsed = Math.min((timestamp - previousTimestamp) / 1000, 0.1);
          const movement = elapsed * currentVideo.playbackRate * 4 * direction;
          const previousTime = currentVideo.currentTime;
          seekArrowScrub(previousTime + movement, direction);
          if (currentVideo.currentTime === previousTime) {
            stopArrowScrub();
            return;
          }
        }
        previousTimestamp = timestamp;
        activeScrub.frameId = window.requestAnimationFrame(advance);
      };
      activeScrub.frameId = window.requestAnimationFrame(advance);
    }, ARROW_SCRUB_HOLD_DELAY_MS);
  }

  globalKeyHandlerRef.current = (event) => {
    if (!file || event.altKey) return;
    const activeElement = document.activeElement;
    const isTextEntry = activeElement instanceof HTMLElement && (
      activeElement.isContentEditable
      || activeElement instanceof HTMLTextAreaElement
      || (activeElement instanceof HTMLInputElement && !['range', 'button', 'checkbox', 'radio'].includes(activeElement.type))
      || activeElement instanceof HTMLSelectElement
    );
    if (isTextEntry) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoEdit();
      else undoEdit();
      return;
    }
    if (event.ctrlKey || event.metaKey) return;

    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      void togglePlayback();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      startArrowScrub(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      videoRef.current?.pause();
      seekVideo(segments[0]?.startTime ?? 0);
    } else if (event.key === 'End') {
      event.preventDefault();
      const lastSegment = segments[segments.length - 1];
      videoRef.current?.pause();
      seekVideo(lastSegment ? Math.max(lastSegment.startTime, lastSegment.endTime - frameDurationRef.current) : 0);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => globalKeyHandlerRef.current(event);
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') stopArrowScrub();
    };
    const handleWindowBlur = () => stopArrowScrub();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      clearSavedLookClickTimeout();
      stopArrowScrub();
    };
  }, []);

  function updateCrop(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / drag.rect.width;
    const dy = (event.clientY - drag.startY) / drag.rect.height;
    const { x, y, width, height } = drag.crop;
    let next = { ...drag.crop };
    if (drag.handle.includes('w')) {
      const left = clamp(x + dx, 0, x + width - MIN_CROP_SIZE);
      next = { ...next, x: left, width: x + width - left };
    }
    if (drag.handle.includes('e')) next.width = clamp(width + dx, MIN_CROP_SIZE, 1 - x);
    if (drag.handle.includes('n')) {
      const top = clamp(y + dy, 0, y + height - MIN_CROP_SIZE);
      next = { ...next, y: top, height: y + height - top };
    }
    if (drag.handle.includes('s')) next.height = clamp(height + dy, MIN_CROP_SIZE, 1 - y);
    if (next.x === crop.x && next.y === crop.y && next.width === crop.width && next.height === crop.height) return;
    recordEdit();
    setCropAspectRatio(null);
    setCrop(next);
  }

  function clearCropDrag() {
    dragRef.current = null;
    finishEditGesture();
  }

  function dismissExportJob(jobId: string) {
    updateExportJobs((current) => current.flatMap((job) => {
      if (job.id !== jobId) return [job];
      return job.status === 'error' ? [] : [{ ...job, dismissed: true }];
    }));
  }

  function removeExportJob(jobId: string) {
    updateExportJobs((current) => current.filter((job) => job.id !== jobId));
  }

  function cancelExport(jobId: string) {
    exportControllers.current.get(jobId)?.abort();
  }

  async function processExportQueue() {
    if (exportQueueRunning.current) return;
    exportQueueRunning.current = true;
    try {
      while (true) {
        const job = exportJobsRef.current.find((item) => item.status === 'queued');
        if (!job) break;

        const controller = new AbortController();
        exportControllers.current.set(job.id, controller);
        updateExportJobs((current) => current.map((item) => (
          item.id === job.id ? { ...item, status: 'exporting', progress: 0 } : item
        )));

        try {
          const output = job.format === 'gif'
            ? await exportGifLocally(
              job.file,
              job.recipe,
              job.duration,
              job.width,
              job.height,
              (progress) => updateExportJobs((current) => current.map((item) => (
                item.id === job.id ? { ...item, progress } : item
              ))),
              controller.signal,
            )
            : await exportMp4Locally(
              job.file,
              job.recipe,
              job.duration,
              job.width,
              job.height,
              (progress) => updateExportJobs((current) => current.map((item) => (
                item.id === job.id ? { ...item, progress } : item
              ))),
              controller.signal,
            );
          if (!controller.signal.aborted) {
            downloadExport(output, job.fileName);
            removeExportJob(job.id);
          }
        } catch (exportError) {
          updateExportJobs((current) => current.flatMap((item) => {
            if (item.id !== job.id) return [item];
            if (item.dismissed) return [];
            return [{
              ...item,
              status: 'error',
              error: controller.signal.aborted
                ? 'Export cancelled.'
                : exportError instanceof Error ? exportError.message : `Could not export ${job.format.toUpperCase()}.`,
            }];
          }));
        } finally {
          exportControllers.current.delete(job.id);
        }
      }
    } finally {
      exportQueueRunning.current = false;
    }
  }

  function startExport() {
    if (!file || !segments.length || !sourceDimensionsValid) return;
    const format = exportFormat;
    const recipe = {
      segments: segments.map((segment) => ({ ...segment })),
      rotation,
      crop: { ...crop },
      adjustments: { ...adjustments },
    };
    try {
      preflightExport(recipe, duration, dimensions.width, dimensions.height);
    } catch (preflightError) {
      setError(preflightError instanceof Error ? preflightError.message : 'Export settings are invalid.');
      return;
    }
    const baseName = mediaName.replace(/\.[^.]+$/, '') || 'onboard';
    const job: ExportJob = {
      id: crypto.randomUUID(),
      file,
      recipe,
      duration,
      width: dimensions.width,
      height: dimensions.height,
      format,
      fileName: `${baseName}.${format}`,
      status: 'queued',
      progress: 0,
    };
    setError('');
    updateExportJobs((current) => [...current, job]);
    void processExportQueue();
  }

  function saveCurrentLook() {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setError('Wait for a video frame to load before saving this look.');
      return;
    }

    try {
      const look: SavedLook = {
        id: crypto.randomUUID(),
        time: video.currentTime,
        thumbnail: createSavedLookThumbnail(video, crop, rotation, adjustments),
        adjustments: { ...adjustments },
      };
      setSavedLooks((current) => [...current, look]);
      setError('');
    } catch (snapshotError) {
      setError(snapshotError instanceof Error
        ? `Could not save this frame: ${snapshotError.message}`
        : 'Could not save this frame.');
    }
  }

  function applySavedLook(look: SavedLook) {
    recordEdit();
    setAdjustments({ ...look.adjustments });
    setActiveSavedLookId(look.id);
  }

  function clearSavedLookClickTimeout() {
    if (savedLookClickTimeoutRef.current !== null) {
      clearTimeout(savedLookClickTimeoutRef.current);
      savedLookClickTimeoutRef.current = null;
    }
  }

  function queueSavedLookApply(look: SavedLook, clickCount: number) {
    clearSavedLookClickTimeout();
    if (clickCount === 0) {
      applySavedLook(look);
      return;
    }
    if (clickCount !== 1) return;
    savedLookClickTimeoutRef.current = setTimeout(() => {
      savedLookClickTimeoutRef.current = null;
      applySavedLook(look);
    }, 400);
  }

  function toggleSavedLookDelete(lookId: string) {
    clearSavedLookClickTimeout();
    setDeletingSavedLookId((current) => current === lookId ? null : lookId);
  }

  function deleteSavedLook(lookId: string) {
    setSavedLooks((current) => current.filter((look) => look.id !== lookId));
    setActiveSavedLookId((current) => current === lookId ? null : current);
    setDeletingSavedLookId(null);
  }

  const rotated = rotation % 180 !== 0;
  const previewTransferTable = buildPreviewTransferTable(adjustments)
    .map((value) => (value / 255).toFixed(6))
    .join(' ');
  const previewSaturation = Math.max(0, 1 + (adjustments.saturation + adjustments.vibrance * 0.6) / 100);
  const previewSharpness = Math.min(2, (adjustments.sharpness + adjustments.definition * 0.7) / 100);
  const previewClarity = adjustments.clarity / 100;
  const cropScaleX = cropOverlayVisible ? 1 : 1 / crop.width;
  const cropScaleY = cropOverlayVisible ? 1 : 1 / crop.height;
  const orientedAspectRatio = rotated ? dimensions.height / dimensions.width : dimensions.width / dimensions.height;
  const cropOffsetX = cropOverlayVisible ? 0 : (0.5 - crop.x) / crop.width - 0.5;
  const cropOffsetY = cropOverlayVisible ? 0 : (0.5 - crop.y) / crop.height - 0.5;
  let videoOffsetX = cropOffsetX;
  let videoOffsetY = cropOffsetY;
  if (rotation === 90) {
    videoOffsetX = cropOffsetY / orientedAspectRatio;
    videoOffsetY = -cropOffsetX * orientedAspectRatio;
  } else if (rotation === 180) {
    videoOffsetX = -cropOffsetX;
    videoOffsetY = -cropOffsetY;
  } else if (rotation === 270) {
    videoOffsetX = -cropOffsetY / orientedAspectRatio;
    videoOffsetY = cropOffsetX * orientedAspectRatio;
  }
  const canvasStyle: CSSProperties = {};
  const videoStyle: CSSProperties = {
    filter: `url(#onboard-adjustments) saturate(${previewSaturation})`,
    width: `${(rotated ? dimensions.width / dimensions.height : 1) * cropScaleX * 100}%`,
    height: `${(rotated ? dimensions.height / dimensions.width : 1) * cropScaleY * 100}%`,
    left: `${(0.5 + videoOffsetX) * 100}%`,
    top: `${(0.5 + videoOffsetY) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  };
  const cropStyle: CSSProperties = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.width * 100}%`,
    height: `${crop.height * 100}%`,
  };
  const excludedRanges: Array<{ startTime: number; endTime: number }> = [];
  const clipBoundaryMarks = [...new Set(segments.flatMap((segment) => [segment.startTime, segment.endTime]))]
    .filter((time) => time > 0 && time < duration);
  const playheadSegmentIndex = segments.findIndex((segment) => isTimeInSegments(currentTime, [segment]));
  const activeTimelineSegmentIndex = playheadSegmentIndex >= 0 ? playheadSegmentIndex : selectedSegmentIndex;
  if (duration > 0) {
    let keptThrough = 0;
    for (const segment of segments) {
      if (segment.startTime > keptThrough) {
        excludedRanges.push({ startTime: keptThrough, endTime: segment.startTime });
      }
      keptThrough = Math.max(keptThrough, segment.endTime);
    }
    if (keptThrough < duration) {
      excludedRanges.push({ startTime: keptThrough, endTime: duration });
    }
  }
  function adjustmentSlider(key: string, label: string) {
    const min = isIncreaseOnlyAdjustment(key) ? 0 : -100;
    const value = adjustments[key];
    const zeroPosition = ((0 - min) / (100 - min)) * 100;
    const valuePosition = ((value - min) / (100 - min)) * 100;
    const fillStart = Math.min(zeroPosition, valuePosition);
    const fillEnd = Math.max(zeroPosition, valuePosition);
    const track = `linear-gradient(to right, #505659 0%, #505659 ${fillStart}%, var(--accent) ${fillStart}%, var(--accent) ${fillEnd}%, #505659 ${fillEnd}%, #505659 100%)`;
    const tickPosition = `calc(5px + ${zeroPosition}% - ${zeroPosition / 10}px)`;
    const defaultTick = `linear-gradient(to bottom, transparent 2px, #a4a8ac 2px, #a4a8ac 8px, transparent 8px) ${tickPosition} center / 1px 10px no-repeat`;
    return (
      <input
        type="range"
        aria-label={label}
        min={min}
        max="100"
        step="10"
        value={value}
        disabled={!file}
        data-adjusted={value !== 0}
        style={{ background: `${defaultTick}, ${track} center / 100% 2px no-repeat` }}
        onPointerDown={beginEditGesture}
        onPointerUp={finishEditGesture}
        onPointerCancel={finishEditGesture}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          if (value !== adjustments[key]) recordEdit();
          setAdjustments((current) => ({ ...current, [key]: value }));
        }}
      />
    );
  }
  return (
    <main className="editor-app">
      <header className="onboard-header">
        <div className="brand-lockup"><span>ONBOARD</span></div>
        <div className="project-title">
          {isRenaming && file ? (
            <>
              <input
                className="project-title-input"
                aria-label="Video name"
                autoFocus
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.currentTarget.value.replace(/\s+/g, '-'))}
                onBlur={finishRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
              <span>{hasRenamedMedia ? `.${exportFormat}` : file.name.match(/\.[^.]+$/)?.[0] ?? '.mp4'}</span>
            </>
          ) : file ? (
            <button className="project-name-button" type="button" onClick={beginRename} aria-label={`Rename video ${mediaName}`}>
              {mediaName}
            </button>
          ) : (
            <span>Untitled {exportFormat.toUpperCase()}</span>
          )}
        </div>
        <div className="header-export-area">
          <div className="export-dropdown" ref={exportMenuRef}>
            <button
              className="export-button"
              type="button"
              onClick={startExport}
              disabled={!file || !duration || !sourceDimensionsValid || !segments.length}
            >
              <Download size={15} /> Export {exportFormat.toUpperCase()}
            </button>
            <button
              className="export-dropdown-toggle"
              type="button"
              aria-label="Choose export format"
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              onClick={() => setExportMenuOpen((open) => !open)}
            >
              <ChevronDown size={15} />
            </button>
            {exportMenuOpen && (
              <div className="export-format-menu" role="menu" aria-label="Export format">
                {(['gif', 'mp4'] as const).map((format) => (
                  <button
                    className="export-format-option"
                    key={format}
                    type="button"
                    role="menuitemradio"
                    aria-checked={exportFormat === format}
                    onClick={() => chooseExportFormat(format)}
                  >
                    {format === exportFormat && <Check size={14} />}
                    <span>Export as {format.toUpperCase()} · up to {Math.round(MAX_EXPORT_BYTES[format] / 1_000_000)} MB</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {exportJobs.some((job) => !job.dismissed) && (
            <section className="export-queue" aria-label="Export queue" aria-live="polite">
              {exportJobs.filter((job) => !job.dismissed).map((job) => (
                <article className={`export-queue-item${job.status === 'error' ? ' error' : ''}`} key={job.id}>
                  <div className="export-queue-heading">
                    <div className="export-queue-copy">
                      <strong>{job.fileName}</strong>
                      <span>
                        {job.status === 'queued'
                          ? `Queued · ${job.format.toUpperCase()}`
                          : job.status === 'exporting'
                            ? `Exporting ${job.format.toUpperCase()} · ${job.progress}%`
                            : job.error}
                      </span>
                    </div>
                    <button
                      className="export-queue-close"
                      type="button"
                      aria-label={`Dismiss ${job.fileName} export notification`}
                      onClick={() => dismissExportJob(job.id)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {job.status === 'exporting' ? (
                    <>
                      <div className="progress-track"><span style={{ width: `${job.progress}%` }} /></div>
                      <button className="export-cancel" type="button" onClick={() => cancelExport(job.id)}>Cancel export</button>
                    </>
                  ) : job.status === 'queued' ? (
                    <div className="progress-track"><span className="export-queue-indeterminate" /></div>
                  ) : null}
                </article>
              ))}
            </section>
          )}
        </div>
      </header>

      <section className="editor-main" aria-label="Video editor">
        <aside className="tool-panel transform-panel" aria-label="Video editing controls">
          <section className="tool-section rotation-section">
            <h2>Rotation</h2>
            <div className="transform-actions">
              <button className="tool-button" type="button" disabled={!file} onClick={rotateVideo}><RotateCw size={15} /> Rotate 90°</button>
            </div>
          </section>

          <section className="tool-section crop-section">
            <h2>Crop</h2>
            <div className="crop-presets" role="group" aria-label="Crop aspect ratio">
              {CROP_PRESETS.map(([label, aspectRatio]) => (
                <button
                  className={cropAspectRatio === aspectRatio ? 'crop-preset active' : 'crop-preset'}
                  type="button"
                  key={label}
                  aria-label={`${label} crop`}
                  aria-pressed={cropAspectRatio === aspectRatio}
                  disabled={!file || !dimensions.width || !dimensions.height}
                  onClick={() => setCropAspect(aspectRatio)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="crop-actions">
              <button
                className="tool-button"
                type="button"
                disabled={!file || (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1 && cropAspectRatio === null)}
                onClick={() => {
                  recordEdit();
                  setCrop({ x: 0, y: 0, width: 1, height: 1 });
                  setCropAspectRatio(null);
                }}
              >
                <Crop size={15} /> Reset crop
              </button>
              <button
                className="tool-button crop-invert-button"
                type="button"
                aria-label={`Switch crop to ${cropAspectRatio ? formatAspectRatio(1 / cropAspectRatio) : 'inverse aspect ratio'}`}
                title="Switch between landscape and portrait crop"
                disabled={!file || !cropAspectRatio || cropAspectRatio === 1}
                onClick={invertCropAspect}
              >
                <ArrowDownUp size={15} />
              </button>
            </div>
          </section>

          <section className="tool-section speed-section">
            <div className="speed-heading">
              <h2>Playback Rate</h2>
              <output htmlFor="playback-rate">{(selectedSegment()?.playbackRate ?? 1).toFixed(1)}×</output>
            </div>
            <div className="speed-control">
              <input
                id="playback-rate"
                type="range"
                aria-label="Selected section playback speed"
                aria-valuetext={`${(selectedSegment()?.playbackRate ?? 1).toFixed(1)}×`}
                min={PLAYBACK_RATE_MIN}
                max={PLAYBACK_RATE_MAX}
                step={PLAYBACK_RATE_STEP}
                value={selectedSegment()?.playbackRate ?? 1}
                disabled={!selectedSegment()}
                onPointerDown={beginEditGesture}
                onPointerUp={finishEditGesture}
                onPointerCancel={finishEditGesture}
                onChange={(event) => setSelectedSegmentSpeed(Number(Number(event.currentTarget.value).toFixed(1)))}
              />
              <div className="speed-slider-ticks" aria-hidden="true">
                {PLAYBACK_RATE_TICKS.map((rate, index) => (
                  <span
                    className={index % 5 === 0 || index === PLAYBACK_RATE_TICKS.length - 1 ? 'major' : ''}
                    key={rate}
                    style={{ left: `${(index / (PLAYBACK_RATE_TICKS.length - 1)) * 100}%` }}
                  />
                ))}
              </div>
              <div className="speed-slider-labels" aria-hidden="true">
                <span>0.5×</span>
                <span>2.0×</span>
              </div>
            </div>
          </section>

          <section className="tool-section source-section">
            <h2>Source</h2>
            <div className="source-actions">
              <button className="tool-button" type="button" onClick={() => fileInput.current?.click()}>
                <Upload size={15} />
                {file ? 'Replace media' : 'Choose MP4'}
              </button>
              <button
                className="source-url-toggle"
                type="button"
                aria-label="Load video from URL"
                aria-expanded={showRemoteSourceInput}
                title="Load video from URL"
                onClick={() => setShowRemoteSourceInput((visible) => !visible)}
              >
                <Link2 size={16} />
              </button>
            </div>
            <input ref={fileInput} className="visually-hidden" type="file" accept="video/mp4,.mp4" onChange={chooseVideo} />
            {showRemoteSourceInput && (
              <form
                className="source-url-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  importRemoteSource(remoteSourceUrl);
                }}
              >
                <label className="visually-hidden" htmlFor="source-video-url">Video source URL</label>
                <input
                  id="source-video-url"
                  type="url"
                  placeholder="https://example.com/video.mp4"
                  value={remoteSourceUrl}
                  onChange={(event) => setRemoteSourceUrl(event.currentTarget.value)}
                  required
                />
                <button className="tool-button" type="submit" disabled={remoteSourceProgress !== null}>
                  {remoteSourceProgress ? 'Loading…' : 'Load URL'}
                </button>
                {remoteSourceProgress && (
                  <span className="source-url-progress" role="status">
                    Loading {remoteSourceProgress.fileName} · {formatByteCount(remoteSourceProgress.loaded)}
                    {remoteSourceProgress.total ? ` of ${formatByteCount(remoteSourceProgress.total)}` : ''}
                  </span>
                )}
              </form>
            )}
          </section>
        </aside>

        <section className="preview-column" aria-label="Video preview">
          <div
            ref={canvasRef}
            className={isDraggingFile ? 'preview-stage dragging' : 'preview-stage'}
            style={canvasStyle}
            onDragOver={(event) => { event.preventDefault(); setIsDraggingFile(true); }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingFile(false);
            }}
            onDrop={dropVideo}
          >
            <svg className="preview-filter-defs" aria-hidden="true">
              <filter id="onboard-adjustments" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
                <feComponentTransfer result="color-adjusted">
                  <feFuncR type="table" tableValues={previewTransferTable} />
                  <feFuncG type="table" tableValues={previewTransferTable} />
                  <feFuncB type="table" tableValues={previewTransferTable} />
                </feComponentTransfer>
                <feGaussianBlur in="color-adjusted" stdDeviation="1.5" result="sharpness-blur" />
                <feComposite
                  in="color-adjusted"
                  in2="sharpness-blur"
                  operator="arithmetic"
                  k1="0"
                  k2={1 + previewSharpness}
                  k3={-previewSharpness}
                  k4="0"
                  result="sharpened"
                />
                <feGaussianBlur in="sharpened" stdDeviation="3.5" result="clarity-blur" />
                <feComposite
                  in="sharpened"
                  in2="clarity-blur"
                  operator="arithmetic"
                  k1="0"
                  k2={1 + previewClarity}
                  k3={-previewClarity}
                  k4="0"
                  result="clarified"
                />
                <feGaussianBlur in="clarified" stdDeviation={adjustments.denoise * 0.02} />
              </filter>
            </svg>
            {!file ? (
              <div className="dropzone">
                {remoteSourceProgress ? (
                  <>
                    <strong>Loading {remoteSourceProgress.fileName}</strong>
                    <div
                      className={remoteSourceProgress.total ? 'remote-import-progress' : 'remote-import-progress indeterminate'}
                      role="progressbar"
                      aria-label="Video import progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={remoteSourceProgress.total
                        ? Math.min(100, Math.round((remoteSourceProgress.loaded / remoteSourceProgress.total) * 100))
                        : undefined}
                    >
                      <span style={{
                        width: remoteSourceProgress.total
                          ? `${Math.min(100, (remoteSourceProgress.loaded / remoteSourceProgress.total) * 100)}%`
                          : undefined,
                      }} />
                    </div>
                    <span aria-live="polite">
                      {formatByteCount(remoteSourceProgress.loaded)}
                      {remoteSourceProgress.total ? ` of ${formatByteCount(remoteSourceProgress.total)}` : ' loaded'}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>Drop an MP4 to begin</strong>
                    <span>or <button type="button" onClick={() => fileInput.current?.click()}>browse files</button></span>
                  </>
                )}
              </div>
            ) : (
              <div className={`onboard-video-frame${cropOverlayVisible ? '' : ' cropped'}`} style={videoFrameStyle} onPointerMove={updateCrop} onPointerUp={clearCropDrag} onPointerCancel={clearCropDrag}>
                <video
                  ref={videoRef}
                  src={previewUrl || undefined}
                  className="onboard-video"
                  style={videoStyle}
                  playsInline
                  preload="auto"
                  tabIndex={0}
                  aria-label={`Video preview. Click to ${cropOverlayVisible ? 'hide' : 'show'} crop marks. Press Space to play or pause.`}
                  onClick={() => setCropOverlayVisible((visible) => !visible)}
                  onLoadedMetadata={onMetadata}
                  onLoadedData={onVideoDataReady}
                  onTimeUpdate={onTimeUpdate}
                  onPlay={() => setPlaying(true)}
                  onPause={onVideoPause}
                  onSeeked={onVideoSeeked}
                  onEnded={onVideoEnded}
                />
                {cropOverlayVisible && (
                  <div className="crop-selection" style={cropStyle} aria-label="Adjust crop by dragging a corner or edge">
                    {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as CropHandle[]).map((handle) => (
                      <button
                        key={handle}
                        type="button"
                        className={`crop-handle ${handle}`}
                        aria-label={`Adjust ${handle} crop ${handle.length === 2 ? 'corner' : 'edge'}`}
                        onPointerDown={(event) => {
                          const frame = event.currentTarget.parentElement?.parentElement;
                          if (!frame) return;
                          event.preventDefault();
                          event.stopPropagation();
                          frame.setPointerCapture(event.pointerId);
                          beginEditGesture();
                          dragRef.current = {
                            handle,
                            crop: { ...crop },
                            rect: frame.getBoundingClientRect(),
                            startX: event.clientX,
                            startY: event.clientY,
                          };
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {error && <p className="inline-error" role="alert">{error}</p>}
        </section>

        <aside className="tool-panel adjustments-panel" aria-label="Adjustments">
          <section className="tool-section adjustment-section">
            <div className="adjustment-heading">
              <h2>Adjustments</h2>
              <div className="adjustment-actions">
                <button
                  className="reset-adjustments-button"
                  type="button"
                  aria-label="Save frame and adjustments"
                  title="Save frame and adjustments"
                  disabled={!file}
                  onClick={saveCurrentLook}
                >
                  <Copy size={14} />
                </button>
                <button
                  className={`reset-adjustments-button saved-looks-toggle${savedLooksVisible ? ' active' : ''}`}
                  type="button"
                  aria-label="Toggle saved frames"
                  title="Toggle saved frames"
                  aria-pressed={savedLooksVisible}
                  disabled={!savedLooks.length}
                  onClick={() => setSavedLooksVisible((visible) => !visible)}
                >
                  <List size={15} />
                </button>
                <button
                  className="reset-adjustments-button"
                  type="button"
                  aria-label="Reset adjustments"
                  title="Reset adjustments"
                  disabled={Object.values(adjustments).every((value) => value === 0)}
                  onClick={() => {
                    recordEdit();
                    setAdjustments(Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0])));
                  }}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
            {savedLooksVisible ? (
              <div className="saved-look-gallery" aria-label="Saved frames">
                {savedLooks.map((look, index) => (
                  <div className="saved-look-card" key={look.id}>
                    <button
                      className={`saved-look${activeSavedLookId === look.id ? ' active' : ''}`}
                      type="button"
                      aria-label={`Apply saved adjustments ${index + 1} from ${formatTime(look.time)}`}
                      aria-pressed={activeSavedLookId === look.id}
                      onClick={(event) => queueSavedLookApply(look, event.detail)}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        toggleSavedLookDelete(look.id);
                      }}
                    >
                      <img src={look.thumbnail} alt="" />
                      <span>{formatTime(look.time)}</span>
                    </button>
                    {deletingSavedLookId === look.id && (
                      <div
                        className="saved-look-delete-overlay"
                      >
                        <button
                          className="saved-look-delete-dismiss"
                          type="button"
                          aria-label={`Cancel deleting saved frame ${index + 1}`}
                          onClick={() => setDeletingSavedLookId(null)}
                        />
                        <button
                          className="saved-look-delete-button"
                          type="button"
                          autoFocus
                          aria-label={`Delete saved frame ${index + 1} from ${formatTime(look.time)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteSavedLook(look.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') setDeletingSavedLookId(null);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="adjustment-list">
                {ADJUSTMENTS.map(([key, label]) => (
                  <label className={`adjustment-control${file ? '' : ' disabled'}`} key={key}>
                    <span>{label}</span>
                    {adjustmentSlider(key, label)}
                  </label>
                ))}
              </div>
            )}
          </section>
        </aside>

      <section className="timeline-editor" aria-label="Video editing timeline">
        <div className="timeline-toolbar">
          <div className="timeline-title">
            <strong>Timeline</strong>
            <span className="timeline-time" aria-label={`Current time ${formatTimecode(currentTime)}, source duration ${formatTimecode(duration)}`}>
              {formatTimecode(currentTime)} / {formatTimecode(duration)}
            </span>
            <span className="timeline-total" aria-label={`Edited output duration ${formatTimecode(editedDuration)}`}>
              {formatTimecode(editedDuration)} total
            </span>
          </div>
          <button className="transport-button" type="button" aria-label={playing ? 'Pause video' : 'Play video'} onClick={() => void togglePlayback()} disabled={!file}>
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <div className="timeline-tools">
            <button className="timeline-tool" type="button" disabled={!canCutAtTime(currentTime)} onClick={() => cutAtTime(currentTime)}>Cut</button>
            <button className="timeline-tool" type="button" onClick={removeSelectedSegment} disabled={segments.length <= 1 || !selectedSegment()}>Remove section</button>
          </div>
        </div>
        <div className="timeline-ruler" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => {
            const time = duration * index / 4;
            return <span key={index} style={{ left: `${index * 25}%` }}>{formatTime(time)}</span>;
          })}
        </div>
        <div
          ref={timelineTrackRef}
          className="timeline-track"
          role="group"
          aria-label="Video timeline"
          tabIndex={duration ? 0 : -1}
          onPointerDown={onTimelinePointerDown}
          onPointerMove={onTimelinePointerMove}
          onPointerUp={onTimelinePointerUp}
          onPointerCancel={onTimelinePointerUp}
          onDoubleClick={onTimelineDoubleClick}
        >
          <div className="timeline-thumbnails" aria-hidden="true">
            {timelineFrames.map((frame, index) => (
              <img src={frame} alt="" key={index} />
            ))}
          </div>
          {!duration && [25, 50, 75].map((position) => (
            <span
              key={`empty-tick-${position}`}
              className="timeline-empty-tick"
              aria-hidden="true"
              style={{ left: `${position}%` }}
            />
          ))}
          {excludedRanges.map((range) => (
            <span
              key={`${range.startTime}-${range.endTime}`}
              className="timeline-excluded"
              aria-hidden="true"
              style={{
                left: `${(range.startTime / duration) * 100}%`,
                width: `${((range.endTime - range.startTime) / duration) * 100}%`,
              }}
            />
          ))}
          {clipBoundaryMarks.map((time) => (
            <span
              key={`cut-${time}`}
              className="timeline-cut-mark"
              aria-hidden="true"
              style={{ left: `${(time / duration) * 100}%` }}
            />
          ))}
          {segments.map((segment, index) => (
            <span
              key={`${segment.startTime}-${segment.endTime}`}
              className={
                segments.length === 1
                  ? `timeline-segment trim-active${index === activeTimelineSegmentIndex ? ' selected active' : ''}`
                  : index === activeTimelineSegmentIndex
                    ? 'timeline-segment selected active'
                    : 'timeline-segment'
              }
              style={{
                left: `${(segment.startTime / duration) * 100}%`,
                width: `${((segment.endTime - segment.startTime) / duration) * 100}%`,
              }}
              aria-current={segments.length > 1 && index === activeTimelineSegmentIndex ? 'true' : undefined}
              onClick={() => selectSegment(index)}
            >
              <span className="segment-label">{segment.playbackRate}×</span>
              <span className="visually-hidden">Kept section {index + 1} at {segment.playbackRate} times speed</span>
              {(segments.length === 1 || index === activeTimelineSegmentIndex) && (
                <>
                  <button type="button" className="timeline-trim-handle start" data-edge="startTime" data-segment-index={index} aria-label={`Trim start of section ${index + 1}`} onKeyDown={onTrimHandleKeyDown}>
                    <span className="timeline-trim-visual" aria-hidden="true" />
                  </button>
                  <button type="button" className="timeline-trim-handle end" data-edge="endTime" data-segment-index={index} aria-label={`Trim end of section ${index + 1}`} onKeyDown={onTrimHandleKeyDown}>
                    <span className="timeline-trim-visual" aria-hidden="true" />
                  </button>
                </>
              )}
            </span>
          ))}
          {duration > 0 && !playheadHiddenAfterTrim && (
            <span
              className="timeline-playhead"
              role="slider"
              aria-label="Timeline playhead"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
              aria-valuetext={formatTime(currentTime)}
              tabIndex={0}
              style={{ left: `${(currentTime / duration) * 100}%` }}
            />
          )}
          {showCutTooltip && duration > 0 && !playheadHiddenAfterTrim && (
            <button
              className="timeline-cut-tooltip"
              type="button"
              aria-label={`Cut at ${formatTime(currentTime)}`}
              title="Cut at this frame"
              disabled={!canCutAtTime(currentTime)}
              style={{ left: `${(currentTime / duration) * 100}%` }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                cutAtTime(currentTime);
              }}
            >
              <Scissors size={14} />
            </button>
          )}
        </div>
      </section>
      </section>
    </main>
  );
}

function waitForMediaEvent(video: HTMLVideoElement, eventName: 'loadedmetadata', signal: AbortSignal) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, onReady);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video metadata could not be loaded.'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Timeline preview cancelled.', 'AbortError'));
    };
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function seekForTimelineFrame(video: HTMLVideoElement, time: number, signal: AbortSignal) {
  if (Math.abs(video.currentTime - time) < 0.001) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('A timeline frame could not be decoded.'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Timeline preview cancelled.', 'AbortError'));
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    video.currentTime = time;
  });
}

function createTimelineThumbnail(
  video: HTMLVideoElement,
  crop: CropRect,
  rotation: VideoEditRecipe['rotation'],
) {
  const scale = Math.min(1, 320 / video.videoWidth, 180 / video.videoHeight);
  const source = document.createElement('canvas');
  source.width = Math.max(1, Math.round(video.videoWidth * scale));
  source.height = Math.max(1, Math.round(video.videoHeight * scale));
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('The browser could not create a timeline preview.');
  sourceContext.drawImage(video, 0, 0, source.width, source.height);

  const oriented = document.createElement('canvas');
  oriented.width = rotation % 180 ? source.height : source.width;
  oriented.height = rotation % 180 ? source.width : source.height;
  const orientedContext = oriented.getContext('2d');
  if (!orientedContext) throw new Error('The browser could not create a timeline preview.');
  orientedContext.translate(oriented.width / 2, oriented.height / 2);
  orientedContext.rotate((rotation * Math.PI) / 180);
  orientedContext.drawImage(source, -source.width / 2, -source.height / 2);

  const cropX = Math.round(crop.x * oriented.width);
  const cropY = Math.round(crop.y * oriented.height);
  const cropWidth = Math.max(1, Math.round(crop.width * oriented.width));
  const cropHeight = Math.max(1, Math.round(crop.height * oriented.height));
  const thumbnail = document.createElement('canvas');
  thumbnail.width = cropWidth;
  thumbnail.height = cropHeight;
  const thumbnailContext = thumbnail.getContext('2d');
  if (!thumbnailContext) throw new Error('The browser could not create a timeline preview.');
  thumbnailContext.drawImage(
    oriented,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    thumbnail.width,
    thumbnail.height,
  );
  return thumbnail.toDataURL('image/jpeg', 0.78);
}

function createSavedLookThumbnail(
  video: HTMLVideoElement,
  crop: CropRect,
  rotation: VideoEditRecipe['rotation'],
  adjustments: Record<string, number>,
) {
  const scale = Math.min(1, 640 / video.videoWidth, 640 / video.videoHeight);
  const source = document.createElement('canvas');
  source.width = Math.max(1, Math.round(video.videoWidth * scale));
  source.height = Math.max(1, Math.round(video.videoHeight * scale));
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('The browser could not create an image preview.');
  sourceContext.drawImage(video, 0, 0, source.width, source.height);

  const image = sourceContext.getImageData(0, 0, source.width, source.height);
  const transferTable = buildPreviewTransferTable(adjustments);
  const saturation = Math.max(0, 1 + (adjustments.saturation + adjustments.vibrance * 0.6) / 100);
  for (let index = 0; index < image.data.length; index += 4) {
    const red = transferTable[image.data[index]] / 255;
    const green = transferTable[image.data[index + 1]] / 255;
    const blue = transferTable[image.data[index + 2]] / 255;
    const luminance = red * 0.213 + green * 0.715 + blue * 0.072;
    image.data[index] = (luminance + (red - luminance) * saturation) * 255;
    image.data[index + 1] = (luminance + (green - luminance) * saturation) * 255;
    image.data[index + 2] = (luminance + (blue - luminance) * saturation) * 255;
  }
  sourceContext.putImageData(image, 0, 0);

  const oriented = document.createElement('canvas');
  oriented.width = rotation % 180 ? source.height : source.width;
  oriented.height = rotation % 180 ? source.width : source.height;
  const orientedContext = oriented.getContext('2d');
  if (!orientedContext) throw new Error('The browser could not create an image preview.');
  orientedContext.translate(oriented.width / 2, oriented.height / 2);
  orientedContext.rotate((rotation * Math.PI) / 180);
  orientedContext.drawImage(source, -source.width / 2, -source.height / 2);

  const cropX = Math.round(crop.x * oriented.width);
  const cropY = Math.round(crop.y * oriented.height);
  const cropWidth = Math.max(1, Math.round(crop.width * oriented.width));
  const cropHeight = Math.max(1, Math.round(crop.height * oriented.height));
  const thumbnailScale = Math.min(1, 320 / cropWidth, 180 / cropHeight);
  const thumbnail = document.createElement('canvas');
  thumbnail.width = Math.max(1, Math.round(cropWidth * thumbnailScale));
  thumbnail.height = Math.max(1, Math.round(cropHeight * thumbnailScale));
  const thumbnailContext = thumbnail.getContext('2d');
  if (!thumbnailContext) throw new Error('The browser could not create an image preview.');
  thumbnailContext.imageSmoothingQuality = 'high';
  thumbnailContext.filter = `blur(${adjustments.denoise * 0.004 * thumbnailScale}px)`;
  thumbnailContext.drawImage(
    oriented,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    thumbnail.width,
    thumbnail.height,
  );
  return thumbnail.toDataURL('image/jpeg', 0.82);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function downloadExport(output: Blob, fileName: string) {
  const url = URL.createObjectURL(output);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.replace(/[\\/:*?"<>|]+/g, '-');
  anchor.style.display = 'none';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function formatAspectRatio(aspectRatio: number) {
  const knownRatios = [
    [1, '1:1'],
    [3 / 4, '3:4'],
    [4 / 3, '4:3'],
    [16 / 9, '16:9'],
    [9 / 16, '9:16'],
  ] as const;
  return knownRatios.find(([ratio]) => Math.abs(ratio - aspectRatio) < 0.001)?.[1] ?? 'custom';
}

function formatTime(seconds: number) {
  return formatTimecode(seconds);
}

function formatTimecode(seconds: number) {
  const centiseconds = Math.round(Math.max(0, seconds) * 100);
  const minutes = Math.floor(centiseconds / 6000);
  const wholeSeconds = Math.floor((centiseconds % 6000) / 100);
  const fractionalSeconds = centiseconds % 100;
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}:${String(fractionalSeconds).padStart(2, '0')}`;
}
