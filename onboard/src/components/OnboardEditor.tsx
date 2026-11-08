import { type ChangeEvent, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { Check, Crop, Download, Pause, Play, RefreshCw, RotateCw, Upload } from 'lucide-react';
import { exportGif as exportGifLocally } from '../lib/editor';
import { validateSourceDimensions } from '../lib/recipe';
import type { VideoEditRecipe } from '../types';

const MIN_CROP_SIZE = 0.05;
const DEFAULT_FRAME_DURATION = 1 / 30;
const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;
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

type CropCorner = 'nw' | 'ne' | 'sw' | 'se';
type CropRect = VideoEditRecipe['crop'];
type VideoSegment = VideoEditRecipe['segments'][number];

export function OnboardEditor() {
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const exportController = useRef<AbortController | null>(null);
  const dragRef = useRef<{ corner: CropCorner; crop: CropRect; rect: DOMRect } | null>(null);
  const frameDurationRef = useRef(DEFAULT_FRAME_DURATION);
  const timelineDragRef = useRef<
    | { type: 'scrub' }
    | { type: 'trim'; index: number; edge: 'startTime' | 'endTime'; segments: VideoSegment[]; rect: DOMRect; pointerX: number }
    | null
  >(null);
  const [file, setFile] = useState<File | null>(null);
  const [mediaName, setMediaName] = useState('');
  const [hasRenamedMedia, setHasRenamedMedia] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [duration, setDuration] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [sourceDimensionsValid, setSourceDimensionsValid] = useState(false);
  const [videoFrameStyle, setVideoFrameStyle] = useState<CSSProperties>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cropOverlayVisible, setCropOverlayVisible] = useState(true);
  const [playheadHiddenAfterTrim, setPlayheadHiddenAfterTrim] = useState(false);
  const playheadHiddenAfterTrimRef = useRef(false);
  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 });
  const [cropAspectRatio, setCropAspectRatio] = useState<number | null>(null);
  const [adjustments, setAdjustments] = useState<Record<string, number>>(
    Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0])),
  );
  const [exportProgress, setExportProgress] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      callbackId = video.requestVideoFrameCallback(observeFrame);
    };
    callbackId = video.requestVideoFrameCallback(observeFrame);
    return () => video.cancelVideoFrameCallback(callbackId);
  }, [previewUrl]);

  useEffect(() => {
    if (!downloadUrl) return;
    return () => URL.revokeObjectURL(downloadUrl);
  }, [downloadUrl]);

  useEffect(() => () => exportController.current?.abort(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dimensions.width || !dimensions.height) return;
    const updateFrame = () => {
      const bounds = canvas.getBoundingClientRect();
      const frameWidth = rotation % 180 ? dimensions.height : dimensions.width;
      const frameHeight = rotation % 180 ? dimensions.width : dimensions.height;
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
  }, [dimensions, rotation]);

  function chooseVideo(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    loadVideo(nextFile);
  }

  function loadVideo(nextFile?: File) {
    setError('');
    setDownloadUrl('');
    setDuration(0);
    setSegments([]);
    setCurrentTime(0);
    setCropOverlayVisible(true);
    setPlayheadHiddenAfterTrim(false);
    playheadHiddenAfterTrimRef.current = false;
    setDimensions({ width: 0, height: 0 });
    setSourceDimensionsValid(false);
    if (!nextFile) return;
    if (!nextFile.name.toLowerCase().endsWith('.mp4') && nextFile.type !== 'video/mp4') {
      setError('Choose an MP4 video.');
      return;
    }
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

  function beginRename() {
    if (!file) return;
    setRenameDraft(mediaName.replace(/\.[^.]+$/, ''));
    setIsRenaming(true);
  }

  function finishRename() {
    if (!file) return;
    const baseName = renameDraft.replace(/\s+/g, '-') || 'video';
    setMediaName(`${baseName}.gif`);
    setHasRenamedMedia(true);
    setIsRenaming(false);
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
    setCropAspectRatio(aspectRatio);
    setCrop(cropForAspectRatio(aspectRatio));
    setCropOverlayVisible(true);
  }

  function rotateVideo() {
    const nextRotation = ROTATIONS[(ROTATIONS.indexOf(rotation) + 1) % ROTATIONS.length];
    setRotation(nextRotation);
    if (cropAspectRatio !== null && dimensions.width && dimensions.height) {
      setCrop(cropForAspectRatio(cropAspectRatio, nextRotation));
    }
  }

  function dropVideo(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingFile(false);
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

  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video || playheadHiddenAfterTrimRef.current) return;
    const time = video.currentTime;
    const segmentIndex = segments.findIndex((segment) => time >= segment.startTime && time < segment.endTime);
    if (segmentIndex >= 0) {
      if (video.playbackRate !== segments[segmentIndex].playbackRate) {
        video.playbackRate = segments[segmentIndex].playbackRate;
      }
    }
    if (segmentIndex >= 0 && time >= segments[segmentIndex].endTime - 0.025) {
      const nextSegment = segments[segmentIndex + 1];
      if (nextSegment) {
        video.currentTime = nextSegment.startTime;
        setCurrentTime(nextSegment.startTime);
      } else {
        video.pause();
        setCurrentTime(segments[segmentIndex].endTime);
      }
      return;
    }
    if (segmentIndex === -1) {
      const nextSegment = segments.find((segment) => segment.startTime > time);
      if (nextSegment) {
        video.currentTime = nextSegment.startTime;
        setCurrentTime(nextSegment.startTime);
      } else if (segments.length) {
        video.pause();
        video.currentTime = segments[segments.length - 1].endTime;
        setCurrentTime(video.currentTime);
      }
      return;
    }
    setCurrentTime(time);
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
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
    const containingSegment = segments.find((segment) => value >= segment.startTime && value < segment.endTime);
    const nextSegment = segments.find((segment) => segment.startTime > value);
    const resolvedTime = containingSegment
      ? value
      : nextSegment?.startTime ?? segments[segments.length - 1]?.endTime ?? 0;
    video.currentTime = resolvedTime;
    const activeIndex = segments.findIndex((segment) => resolvedTime >= segment.startTime && resolvedTime < segment.endTime);
    if (activeIndex >= 0) {
      video.playbackRate = segments[activeIndex].playbackRate;
    }
    setCurrentTime(resolvedTime);
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
      timelineDragRef.current = {
        type: 'trim',
        index: segmentIndex,
        edge,
        segments: segments.map((segment) => ({ ...segment })),
        rect: event.currentTarget.getBoundingClientRect(),
        pointerX: event.clientX,
      };
      setSelectedSegmentIndex(segmentIndex);
      return;
    }
    const playhead = event.target instanceof HTMLElement ? event.target.closest('.timeline-playhead') : null;
    if (!playhead) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    timelineDragRef.current = { type: 'scrub' };
  }

  function onTimelineKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!duration) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seekVideo(currentTime + (event.key === 'ArrowLeft' ? -frameDurationRef.current : frameDurationRef.current));
    } else if (event.key === 'Home') {
      event.preventDefault();
      seekVideo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      seekVideo(duration);
    }
  }

  function onTimelinePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = timelineDragRef.current;
    if (!drag) return;
    if (drag.type === 'scrub') {
      seekVideo(getTimelineTime(event));
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
    if (!playheadHiddenAfterTrim) {
      playheadHiddenAfterTrimRef.current = true;
      setPlayheadHiddenAfterTrim(true);
      videoRef.current?.pause();
    }
    setSegments(updated);
  }

  function onTimelinePointerUp() {
    const drag = timelineDragRef.current;
    timelineDragRef.current = null;
    if (drag?.type !== 'trim' || !playheadHiddenAfterTrimRef.current) return;
    const firstSegment = segments[0];
    if (!firstSegment) return;
    if (videoRef.current) videoRef.current.currentTime = firstSegment.startTime;
    setCurrentTime(firstSegment.startTime);
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
    playheadHiddenAfterTrimRef.current = true;
    setPlayheadHiddenAfterTrim(true);
    videoRef.current?.pause();
    setSegments(updated);
    setSelectedSegmentIndex(index);
    if (videoRef.current) videoRef.current.currentTime = updated[0].startTime;
    setCurrentTime(updated[0].startTime);
  }

  function cutAtTime(time: number) {
    const index = getSegmentIndexAtCutTime(time);
    if (index < 0) return;
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
    if (segments.length <= 1 || !segments[selectedSegmentIndex]) return;
    const removed = segments[selectedSegmentIndex];
    const next = segments.filter((_, index) => index !== selectedSegmentIndex);
    const nextIndex = Math.min(selectedSegmentIndex, next.length - 1);
    setSegments(next);
    setSelectedSegmentIndex(nextIndex);
    const nextTime = next[nextIndex].startTime;
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
      videoRef.current.playbackRate = next[nextIndex].playbackRate;
    }
    setCurrentTime(nextTime);
  }

  function selectedSegment() {
    return segments[selectedSegmentIndex];
  }

  function setSelectedSegmentSpeed(playbackRate: number) {
    const segment = selectedSegment();
    if (!segment) return;
    setSegments((current) => current.map((segment, index) => (
      index === selectedSegmentIndex ? { ...segment, playbackRate } : segment
    )));
    if (videoRef.current && currentTime >= segment.startTime && currentTime < segment.endTime) {
      videoRef.current.playbackRate = playbackRate;
    }
  }

  function selectSegment(index: number) {
    if (segments.length <= 1 || !segments[index]) return;
    setSelectedSegmentIndex(index);
  }

  function updateCrop(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.rect.left) / drag.rect.width;
    const dy = (event.clientY - drag.rect.top) / drag.rect.height;
    const { x, y, width, height } = drag.crop;
    let next = { ...drag.crop };
    if (drag.corner.includes('w')) {
      const left = clamp(x + dx, 0, x + width - MIN_CROP_SIZE);
      next = { ...next, x: left, width: x + width - left };
    }
    if (drag.corner.includes('e')) next.width = clamp(width + dx, MIN_CROP_SIZE, 1 - x);
    if (drag.corner.includes('n')) {
      const top = clamp(y + dy, 0, y + height - MIN_CROP_SIZE);
      next = { ...next, y: top, height: y + height - top };
    }
    if (drag.corner.includes('s')) next.height = clamp(height + dy, MIN_CROP_SIZE, 1 - y);
    setCropAspectRatio(null);
    setCrop(next);
  }

  function clearCropDrag() {
    dragRef.current = null;
  }

  function recipe(): VideoEditRecipe {
    return { segments, rotation, crop, adjustments };
  }

  async function startExport() {
    if (!file || !segments.length || !sourceDimensionsValid) return;
    const controller = new AbortController();
    exportController.current = controller;
    setBusy(true);
    setError('');
    setDownloadUrl('');
    setExportProgress(0);
    try {
      const gif = await exportGifLocally(file, recipe(), duration, setExportProgress, controller.signal);
      if (!controller.signal.aborted) setDownloadUrl(URL.createObjectURL(gif));
    } catch (exportError) {
      setError(controller.signal.aborted
        ? 'Export cancelled.'
        : exportError instanceof Error ? exportError.message : 'Could not export this GIF.');
    } finally {
      if (exportController.current === controller) exportController.current = null;
      setBusy(false);
    }
  }

  function cancelExport() {
    exportController.current?.abort();
  }

  const videoFilter = `brightness(${Math.max(0.1, 1 + (adjustments.brightness + adjustments.exposure * 0.35 + adjustments.brilliance * 0.15 + adjustments.highlights * 0.1 + adjustments.shadows * 0.2) / 100)}) contrast(${Math.max(0.1, 1 + (adjustments.contrast + adjustments.sharpness * 0.1 + adjustments.definition * 0.1 + adjustments.clarity * 0.2) / 100)}) saturate(${Math.max(0, 1 + (adjustments.saturation + adjustments.vibrance * 0.6) / 100)}) blur(${adjustments.denoise * 0.004}px)`;
  const rotated = rotation % 180 !== 0;
  const canvasStyle: CSSProperties = {};
  const videoStyle: CSSProperties = {
    filter: videoFilter,
    width: rotated ? `${(dimensions.width / dimensions.height) * 100}%` : '100%',
    height: rotated ? `${(dimensions.height / dimensions.width) * 100}%` : '100%',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  };
  const cropStyle: CSSProperties = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.width * 100}%`,
    height: `${crop.height * 100}%`,
  };
  const excludedRanges: Array<{ startTime: number; endTime: number }> = [];
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
    const min = key === 'denoise' ? 0 : -100;
    const value = adjustments[key];
    const zeroPosition = ((0 - min) / (100 - min)) * 100;
    const valuePosition = ((value - min) / (100 - min)) * 100;
    const fillStart = Math.min(zeroPosition, valuePosition);
    const fillEnd = Math.max(zeroPosition, valuePosition);
    const track = `linear-gradient(to right, #505659 0%, #505659 ${fillStart}%, var(--accent) ${fillStart}%, var(--accent) ${fillEnd}%, #505659 ${fillEnd}%, #505659 100%)`;
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
        style={{ background: `${track} center / 100% 2px no-repeat` }}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
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
              <span>{hasRenamedMedia ? '.gif' : file.name.match(/\.[^.]+$/)?.[0] ?? '.mp4'}</span>
            </>
          ) : file ? (
            <button className="project-name-button" type="button" onClick={beginRename} aria-label={`Rename video ${mediaName}`}>
              {mediaName}
            </button>
          ) : (
            <span>Untitled GIF</span>
          )}
        </div>
        {busy
          ? (
            <div className="export-status" aria-live="polite">
              <div className="progress-track"><span style={{ width: `${exportProgress}%` }} /></div>
              <span className="export-progress-label">{exportProgress < 5 ? 'Loading editor' : 'Encoding'} · {exportProgress}%</span>
              <button className="export-cancel" type="button" onClick={cancelExport}>Cancel</button>
            </div>
          )
          : downloadUrl
          ? <a className="export-button ready" href={downloadUrl} download={`${mediaName.replace(/\.[^.]+$/, '') || 'onboard'}.gif`}><Check size={15} /> Download GIF</a>
          : <button className="export-button" type="button" onClick={startExport} disabled={!file || !duration || !sourceDimensionsValid || !segments.length}><Download size={15} /> Export GIF</button>}
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
            <button
              className="tool-button"
              type="button"
              disabled={!file || (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1 && cropAspectRatio === null)}
              onClick={() => {
                setCrop({ x: 0, y: 0, width: 1, height: 1 });
                setCropAspectRatio(null);
              }}
            >
              <Crop size={15} /> Reset crop
            </button>
          </section>

          <section className="tool-section speed-section">
            <h2>Playback Rate</h2>
            <div className="speed-options" role="group" aria-label="Selected section playback speed">
              {PLAYBACK_RATES.map((rate) => (
                <button
                  key={rate}
                  className={selectedSegment()?.playbackRate === rate ? 'speed-option active' : 'speed-option'}
                  type="button"
                  aria-pressed={selectedSegment()?.playbackRate === rate}
                  disabled={!selectedSegment()}
                  onClick={() => setSelectedSegmentSpeed(rate)}
                >
                  {rate}×
                </button>
              ))}
            </div>
          </section>

          <section className="tool-section source-section">
            <h2>Source</h2>
            <button className="tool-button" type="button" onClick={() => fileInput.current?.click()}>
              <Upload size={15} />
              {file ? 'Replace media' : 'Choose MP4'}
            </button>
            <input ref={fileInput} className="visually-hidden" type="file" accept="video/mp4,.mp4" onChange={chooseVideo} />
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
            {!file ? (
              <div className="dropzone">
                <strong>Drop an MP4 to begin</strong>
                <span>or <button type="button" onClick={() => fileInput.current?.click()}>browse files</button></span>
              </div>
            ) : (
              <div className="onboard-video-frame" style={videoFrameStyle} onPointerMove={updateCrop} onPointerUp={clearCropDrag} onPointerCancel={clearCropDrag}>
                <video
                  ref={videoRef}
                  src={previewUrl || undefined}
                  className="onboard-video"
                  style={videoStyle}
                  playsInline
                  preload="metadata"
                  tabIndex={0}
                  aria-label={`Video preview. Click to ${cropOverlayVisible ? 'hide' : 'show'} crop marks. Press Space to play or pause.`}
                  onClick={() => setCropOverlayVisible((visible) => !visible)}
                  onKeyDown={(event) => {
                    if (event.key === ' ') {
                      event.preventDefault();
                      void togglePlayback();
                    }
                  }}
                  onLoadedMetadata={onMetadata}
                  onTimeUpdate={onTimeUpdate}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                />
                {cropOverlayVisible && (
                  <div className="crop-selection" style={cropStyle} aria-label="Adjust crop by dragging a corner">
                    {(['nw', 'ne', 'sw', 'se'] as CropCorner[]).map((corner) => (
                      <button
                        key={corner}
                        type="button"
                        className={`crop-handle ${corner}`}
                        aria-label={`Adjust ${corner} crop corner`}
                        onPointerDown={(event) => {
                          const frame = event.currentTarget.parentElement?.parentElement;
                          if (!frame) return;
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          dragRef.current = { corner, crop: { ...crop }, rect: frame.getBoundingClientRect() };
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
              <button
                className="reset-adjustments-button"
                type="button"
                aria-label="Reset adjustments"
                disabled={Object.values(adjustments).every((value) => value === 0)}
                onClick={() => setAdjustments(Object.fromEntries(ADJUSTMENTS.map(([key]) => [key, 0])))}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="adjustment-list">
              {ADJUSTMENTS.map(([key, label]) => (
                <label className={`adjustment-control${file ? '' : ' disabled'}`} key={key}>
                  <span>{label}</span>
                  {adjustmentSlider(key, label)}
                </label>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <section className="timeline-editor" aria-label="Video editing timeline">
        <div className="timeline-toolbar">
          <div className="timeline-title"><strong>Timeline</strong></div>
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
          className="timeline-track"
          role="group"
          aria-label="Video timeline"
          tabIndex={duration ? 0 : -1}
          onPointerDown={onTimelinePointerDown}
          onPointerMove={onTimelinePointerMove}
          onPointerUp={onTimelinePointerUp}
          onPointerCancel={onTimelinePointerUp}
          onKeyDown={onTimelineKeyDown}
        >
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
          {segments.map((segment, index) => (
            <span
              key={`${segment.startTime}-${segment.endTime}`}
              className={
                segments.length === 1
                  ? 'timeline-segment trim-active'
                  : index === selectedSegmentIndex
                    ? 'timeline-segment selected'
                    : 'timeline-segment'
              }
              style={{
                left: `${(segment.startTime / duration) * 100}%`,
                width: `${((segment.endTime - segment.startTime) / duration) * 100}%`,
              }}
              aria-current={segments.length > 1 && index === selectedSegmentIndex ? 'true' : undefined}
              onClick={() => selectSegment(index)}
            >
              <span className="segment-label">{segment.playbackRate}×</span>
              <span className="visually-hidden">Kept section {index + 1} at {segment.playbackRate} times speed</span>
              {(segments.length === 1 || index === selectedSegmentIndex) && (
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
        </div>
      </section>
    </main>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(1).padStart(4, '0')}`;
}
