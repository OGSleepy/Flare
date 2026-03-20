import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ImagePlus, Loader2, FlipHorizontal, ZoomIn, Zap, Timer, Video } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { NostrSigner } from '@nostrify/nostrify';
import { StoryEditor } from '@/components/StoryEditor';
import { toast } from 'sonner';

interface CameraScreenProps { signer: NostrSigner | null; }

type TimerMode = 0 | 3 | 10;
type FlashMode = 'off' | 'on';

export const CameraScreen: React.FC<CameraScreenProps> = ({ signer }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const flashOverlayRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [camReady, setCamReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const lastPinchDist = useRef<number | null>(null);
  const [cameraKey, setCameraKey] = useState(0);

  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  const [timerMode, setTimerMode] = useState<TimerMode>(0);
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [countdown, setCountdown] = useState<number | null>(null);

  // Video recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const MIN_ZOOM = 1, MAX_ZOOM = 4;
  const MAX_RECORD_SECONDS = 30;

  const pubkey = useAppStore(s => s.pubkey);

  // ── Camera start ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setCamReady(false);
    const start = async () => {
      try {
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (!navigator.mediaDevices?.getUserMedia) return;
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.addEventListener('canplay', () => {
          if (!cancelled) video.play().catch(() => {}).finally(() => { if (!cancelled) setCamReady(true); });
        }, { once: true });
      } catch { if (!cancelled) setCamReady(false); }
    };
    start();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };
  }, [facingMode, cameraKey]);

  // ── Pinch zoom ────────────────────────────────────────────────────────────
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !lastPinchDist.current) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (dist / lastPinchDist.current!))));
    lastPinchDist.current = dist;
  }, []);

  const onTouchEnd = useCallback(() => { lastPinchDist.current = null; }, []);

  // ── Flash ─────────────────────────────────────────────────────────────────
  const triggerFlash = useCallback(() => {
    const el = flashOverlayRef.current;
    if (!el) return;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 150);
  }, []);

  // ── Photo capture ─────────────────────────────────────────────────────────
  const doCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) {
      toast.error('Camera not ready');
      return;
    }
    if (flashMode === 'on') triggerFlash();

    const scale = zoom;
    const vw = video.videoWidth, vh = video.videoHeight;
    const cropW = vw / scale, cropH = vh / scale;
    const cropX = (vw - cropW) / 2, cropY = (vh - cropH) / 2;
    canvas.width = cropW; canvas.height = cropH;
    const ctx = canvas.getContext('2d')!;
    if (facingMode === 'user') { ctx.translate(cropW, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setCapturedDataUrl(dataUrl);
    canvas.toBlob(blob => { if (blob) setCapturedBlob(blob); }, 'image/jpeg', 0.9);
  }, [zoom, facingMode, flashMode, triggerFlash]);

  // ── Video recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !camReady) return;
    recordedChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : 'video/mp4';

    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setCapturedDataUrl(url);
        setCapturedBlob(blob);
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordSeconds(0);
      recordIntervalRef.current = setInterval(() => {
        setRecordSeconds(s => {
          if (s >= MAX_RECORD_SECONDS - 1) { stopRecording(); return s; }
          return s + 1;
        });
      }, 1000);
    } catch (e: any) { toast.error('Recording not supported on this device'); }
  }, [camReady]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordIntervalRef.current) { clearInterval(recordIntervalRef.current); recordIntervalRef.current = null; }
    setIsRecording(false);
    setRecordSeconds(0);
  }, []);

  // ── Shutter: tap = photo, hold = video ────────────────────────────────────
  const handleShutterDown = useCallback(() => {
    if (!camReady) return;
    holdTimerRef.current = setTimeout(() => {
      // Held for 300ms → start video
      holdTimerRef.current = null;
      startRecording();
    }, 300);
  }, [camReady, startRecording]);

  const handleShutterUp = useCallback(() => {
    if (holdTimerRef.current) {
      // Released before hold threshold → take photo
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (timerMode === 0) {
        doCapture();
      } else {
        setCountdown(timerMode);
        const interval = setInterval(() => {
          setCountdown(c => {
            if (c === null || c <= 1) { clearInterval(interval); setCountdown(null); doCapture(); return null; }
            return c - 1;
          });
        }, 1000);
      }
    } else if (isRecording) {
      stopRecording();
    }
  }, [timerMode, doCapture, isRecording, stopRecording]);

  const cycleTimer = () => setTimerMode(t => t === 0 ? 3 : t === 3 ? 10 : 0);
  const cycleFlash = () => setFlashMode(f => f === 'off' ? 'on' : 'off');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCapturedDataUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
    setCapturedBlob(file);
    e.target.value = '';
  };

  const discard = useCallback(() => {
    setCapturedDataUrl(null); setCapturedBlob(null); setZoom(1);
    setCameraKey(k => k + 1);
  }, []);

  if (capturedDataUrl && capturedBlob) {
    return <StoryEditor imageDataUrl={capturedDataUrl} imageBlob={capturedBlob} onDiscard={discard} signer={signer} />;
  }

  return (
    <div className="relative flex flex-col h-full bg-black overflow-hidden">
      {/* Viewfinder */}
      <div className="absolute inset-0" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <video ref={videoRef} autoPlay playsInline muted
          className={`w-full h-full transition-opacity duration-300 ${camReady ? 'opacity-100' : 'opacity-0'}`}
          style={{ objectFit: 'cover', transform: `scale(${zoom}) ${facingMode === 'user' ? 'scaleX(-1)' : ''}`, transformOrigin: 'center center' }} />
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Flash overlay */}
      <div ref={flashOverlayRef} className="absolute inset-0 bg-white pointer-events-none z-30 transition-opacity duration-150" style={{ opacity: 0 }} />

      {!camReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
          <Loader2 size={32} className="text-white/60 animate-spin" />
          <p className="text-white/40 text-xs">Starting camera…</p>
        </div>
      )}

      {/* Timer countdown */}
      {countdown !== null && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <span className="text-white font-display font-extrabold" style={{ fontSize: 120, textShadow: '0 0 40px rgba(249,115,22,0.8)' }}>{countdown}</span>
        </div>
      )}

      {/* Recording indicator */}
      {isRecording && (
        <div className="absolute top-20 left-0 right-0 flex justify-center z-20 pointer-events-none safe-top">
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur rounded-full px-4 py-2 border border-red-500/40">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white text-sm font-semibold">{recordSeconds}s</span>
            <span className="text-white/50 text-xs">/ {MAX_RECORD_SECONDS}s · Release to stop</span>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-5 safe-top pt-14">
        <div className="flex items-center gap-2">
          <button onClick={cycleFlash}
            className={`w-10 h-10 rounded-full backdrop-blur flex items-center justify-center border transition-all ${flashMode === 'on' ? 'bg-yellow-400 border-yellow-400 text-black' : 'bg-black/50 border-white/10 text-white'}`}>
            <Zap size={18} fill={flashMode === 'on' ? 'currentColor' : 'none'} />
          </button>
          <button onClick={cycleTimer}
            className={`px-3 h-10 rounded-full backdrop-blur flex items-center gap-1.5 border transition-all ${timerMode > 0 ? 'bg-flare-500 border-flare-500 text-white' : 'bg-black/50 border-white/10 text-white'}`}>
            <Timer size={16} />
            <span className="text-xs font-semibold">{timerMode === 0 ? 'Off' : `${timerMode}s`}</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {zoom > 1.05 && (
            <div className="flex items-center gap-1 bg-black/50 backdrop-blur rounded-full px-2.5 py-1">
              <ZoomIn size={12} className="text-flare-400" />
              <span className="text-white text-xs font-semibold">{zoom.toFixed(1)}×</span>
            </div>
          )}
          <button onClick={() => { setZoom(1); setFacingMode(m => m === 'user' ? 'environment' : 'user'); }}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white border border-white/10">
            <FlipHorizontal size={18} />
          </button>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center px-8"
        style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom, 0px))' }}>
        {/* Upload */}
        <div className="flex-1 flex justify-start">
          <button onClick={() => fileRef.current?.click()}
            className="w-14 h-14 rounded-2xl bg-black/60 backdrop-blur flex flex-col items-center justify-center gap-0.5 border border-white/25 active:scale-95 transition-transform">
            <ImagePlus size={22} className="text-white" />
            <span className="text-white/60 text-[9px] font-medium">Upload</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFile} />
        </div>

        {/* Shutter — tap for photo, hold for video */}
        <div className="flex-1 flex flex-col items-center gap-2">
          <p className="text-white/30 text-[9px] tracking-wider uppercase">
            {isRecording ? 'Release to stop' : 'Tap photo · Hold video'}
          </p>
          <button
            onPointerDown={handleShutterDown}
            onPointerUp={handleShutterUp}
            onPointerLeave={handleShutterUp}
            disabled={!camReady || countdown !== null}
            className="disabled:opacity-40 transition-transform active:scale-95 touch-none"
            style={{ touchAction: 'none' }}
          >
            {/* Outer ring — red when recording */}
            <div className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{ boxShadow: isRecording ? '0 0 0 4px rgba(239,68,68,0.9)' : '0 0 0 4px rgba(255,255,255,0.9)' }}>
              <div className={`rounded-full transition-all duration-150 ${isRecording ? 'w-10 h-10 rounded-xl bg-red-500' : 'w-[62px] h-[62px] bg-white'}`} />
            </div>
          </button>
        </div>

        {/* Video mode indicator */}
        <div className="flex-1 flex justify-end">
          <div className="w-14 h-14 rounded-2xl bg-black/40 flex flex-col items-center justify-center gap-0.5 border border-white/10">
            <Video size={18} className={isRecording ? 'text-red-400' : 'text-white/40'} />
            <span className="text-white/40 text-[9px]">Hold</span>
          </div>
        </div>
      </div>
    </div>
  );
};
