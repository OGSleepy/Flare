import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Zap, X, ImagePlus, Loader2, FlipHorizontal, ZoomIn } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { getPool, STORY_KIND, STORY_EXPIRY, unixNow } from '@/lib/nostr';
import { uploadFile } from '@/lib/upload';
import type { NostrSigner } from '@nostrify/nostrify';
import type { FlareStory } from '@/types';
import { toast } from 'sonner';

interface CameraScreenProps { signer: NostrSigner | null; }

export const CameraScreen: React.FC<CameraScreenProps> = ({ signer }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [captured, setCaptured] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [caption, setCaption] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [shutterAnim, setShutterAnim] = useState(false);
  const [camReady, setCamReady] = useState(false);

  // Pinch-to-zoom state
  const [zoom, setZoom] = useState(1);
  const lastPinchDist = useRef<number | null>(null);
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;

  const pubkey = useAppStore(s => s.pubkey);
  const addStory = useAppStore(s => s.addStory);

  // Start camera — no width/height constraints to avoid forced zoom crop
  useEffect(() => {
    let cancelled = false;
    setCamReady(false);

    const start = async () => {
      try {
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (!navigator.mediaDevices?.getUserMedia) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        });

        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;

        // Wait for canplay — this fires when the video is actually renderable
        const onCanPlay = () => {
          if (!cancelled) {
            video.play().then(() => {
              if (!cancelled) setCamReady(true);
            }).catch(() => {
              if (!cancelled) setCamReady(true); // still mark ready — autoPlay may have worked
            });
          }
        };

        video.addEventListener('canplay', onCanPlay, { once: true });
      } catch (e) {
        console.error('Camera error:', e);
        if (!cancelled) setCamReady(false);
      }
    };

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [facingMode]);

  // Pinch-to-zoom touch handlers
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2 || lastPinchDist.current === null) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const delta = dist / lastPinchDist.current;
    lastPinchDist.current = dist;
    setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * delta)));
  }, []);

  const onTouchEnd = useCallback(() => {
    lastPinchDist.current = null;
  }, []);

  // Capture — wait for video to have real dimensions
  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Safety check — video must be playing and have real dimensions
    if (video.readyState < 2 || video.videoWidth === 0) {
      toast.error('Camera not ready yet');
      return;
    }

    setShutterAnim(true);
    setTimeout(() => setShutterAnim(false), 150);

    // Account for zoom when capturing
    const scale = zoom;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Crop the center based on zoom level
    const cropW = vw / scale;
    const cropH = vh / scale;
    const cropX = (vw - cropW) / 2;
    const cropY = (vh - cropH) / 2;

    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Mirror if front camera
    if (facingMode === 'user') {
      ctx.translate(cropW, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setCaptured(dataUrl);
    canvas.toBlob(blob => {
      if (blob) setCapturedBlob(blob);
    }, 'image/jpeg', 0.9);
  }, [zoom, facingMode]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCaptured(ev.target?.result as string);
    reader.readAsDataURL(file);
    setCapturedBlob(file);
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const discard = () => { setCaptured(null); setCapturedBlob(null); setCaption(''); setZoom(1); };

  const publish = async () => {
    if (!capturedBlob || !signer || !pubkey) { toast.error('Sign in to post stories'); return; }
    setPublishing(true);
    try {
      const isVideo = capturedBlob.type.startsWith('video/');
      const ext = isVideo ? 'mp4' : 'jpg';
      const mime = isVideo ? 'video/mp4' : 'image/jpeg';
      const file = capturedBlob instanceof File ? capturedBlob : new File([capturedBlob], `story.${ext}`, { type: mime });
      const upload = await uploadFile(file, signer as any);
      const pool = getPool();
      const now = unixNow();
      const event = await (signer as any).signEvent({
        kind: STORY_KIND,
        content: caption,
        created_at: now,
        tags: [
          ['url', upload.url],
          ['m', file.type],
          ['x', upload.sha256],
          ['expiration', String(now + STORY_EXPIRY)],
          ...(caption ? [['alt', caption]] : []),
        ],
      });
      await pool.event(event);
      const story: FlareStory = {
        id: event.id,
        pubkey,
        mediaUrl: upload.url,
        mediaType: isVideo ? 'video' : 'image',
        caption: caption || undefined,
        created_at: now,
        expires_at: now + STORY_EXPIRY,
        tags: event.tags,
      };
      addStory(story);
      toast.success('Story posted 🔥');
      discard();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to post story');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="relative flex flex-col h-full bg-black overflow-hidden">
      {!captured ? (
        <>
          {/* Viewfinder */}
          <div
            ref={viewfinderRef}
            className="absolute inset-0"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full transition-opacity duration-300 ${camReady ? 'opacity-100' : 'opacity-0'}`}
              style={{
                objectFit: 'cover',
                transform: `scale(${zoom}) ${facingMode === 'user' ? 'scaleX(-1)' : ''}`,
                transformOrigin: 'center center',
              }}
            />
          </div>

          <canvas ref={canvasRef} className="hidden" />

          {/* Loading spinner */}
          {!camReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <Loader2 size={32} className="text-white/60 animate-spin" />
              <p className="text-white/40 text-xs">Starting camera…</p>
            </div>
          )}

          {/* Shutter flash */}
          {shutterAnim && (
            <div className="absolute inset-0 bg-white z-30 pointer-events-none" style={{ animation: 'shutter 0.15s ease forwards' }} />
          )}

          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 safe-top pt-14">
            {/* Zoom indicator */}
            {zoom > 1.05 && (
              <div className="flex items-center gap-1 bg-black/50 backdrop-blur rounded-full px-2.5 py-1">
                <ZoomIn size={12} className="text-flare-400" />
                <span className="text-white text-xs font-semibold">{zoom.toFixed(1)}×</span>
              </div>
            )}
            {zoom <= 1.05 && <div />}

            {/* Flip camera */}
            <button
              onClick={() => { setZoom(1); setFacingMode(m => m === 'user' ? 'environment' : 'user'); }}
              className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white border border-white/10"
            >
              <FlipHorizontal size={18} />
            </button>
          </div>

          {/* Zoom hint */}
          {camReady && zoom === 1 && (
            <div className="absolute top-1/2 left-0 right-0 flex justify-center z-10 pointer-events-none -mt-16">
              <p className="text-white/20 text-xs">Pinch to zoom</p>
            </div>
          )}

          {/* Bottom controls — extra padding to clear nav + safe area */}
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center px-8 pb-28" style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom, 0px))' }}>
            {/* Gallery / upload */}
            <div className="flex-1 flex justify-start">
              <button
                onClick={() => fileRef.current?.click()}
                className="w-14 h-14 rounded-2xl bg-black/60 backdrop-blur flex flex-col items-center justify-center gap-0.5 border border-white/25 active:scale-95 transition-transform"
              >
                <ImagePlus size={22} className="text-white" />
                <span className="text-white/60 text-[9px] font-medium">Upload</span>
              </button>
              <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFile} />
            </div>

            {/* Shutter */}
            <div className="flex-1 flex justify-center">
              <button
                onPointerDown={capture}
                disabled={!camReady}
                className="w-20 h-20 rounded-full flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
                style={{ boxShadow: '0 0 0 4px rgba(255,255,255,0.9)' }}
              >
                <div className="w-[62px] h-[62px] rounded-full bg-white" />
              </button>
            </div>

            {/* Spacer */}
            <div className="flex-1" />
          </div>
        </>
      ) : (
        /* Preview */
        <div className="flex flex-col h-full">
          <div className="relative flex-1 overflow-hidden">
            <img src={captured} alt="Preview" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom,transparent 55%,rgba(0,0,0,0.85) 100%)' }} />
            <button onClick={discard} className="absolute top-14 left-5 safe-top w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center text-white z-10 border border-white/10">
              <X size={20} />
            </button>
          </div>
          {/* Caption + post bar — sits above nav */}
          <div className="bg-black flex-shrink-0 px-4 pt-3 pb-4 space-y-3 border-t border-white/5"
            style={{ paddingBottom: 'calc(1rem + 64px + env(safe-area-inset-bottom, 0px))' }}>
            <input
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Add a caption…"
              maxLength={140}
              className="w-full bg-white/10 border border-white/15 rounded-2xl px-4 py-3 text-white text-sm placeholder-white/40 focus:outline-none focus:border-flare-500/60"
            />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-semibold">Post to story</p>
                <p className="text-gray-500 text-xs">Disappears in 24 hours</p>
              </div>
              <button
                onClick={publish}
                disabled={publishing}
                className="flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-white disabled:opacity-50 flare-glow"
                style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)' }}
              >
                {publishing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                {publishing ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
