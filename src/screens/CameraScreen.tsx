import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Camera, RotateCcw, Zap, X, Check, ImagePlus, Loader2, FlipHorizontal,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { getPool, STORY_KIND, STORY_EXPIRY, unixNow } from '@/lib/nostr';
import { uploadFile } from '@/lib/upload';
import type { NostrSigner } from '@nostrify/nostrify';
import type { FlareStory } from '@/types';
import { toast } from 'sonner';

interface CameraScreenProps {
  signer: NostrSigner | null;
}

export const CameraScreen: React.FC<CameraScreenProps> = ({ signer }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [captured, setCaptured] = useState<string | null>(null); // data URL
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [caption, setCaption] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [shutterAnim, setShutterAnim] = useState(false);
  const [camReady, setCamReady] = useState(false);

  const { pubkey, addStory } = useAppStore(s => ({ pubkey: s.pubkey, addStory: s.addStory }));

  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1080 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCamReady(true);
      }
    } catch { setCamReady(false); }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [startCamera]);

  const capture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    setShutterAnim(true);
    setTimeout(() => setShutterAnim(false), 200);

    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    const dataUrl = c.toDataURL('image/jpeg', 0.88);
    setCaptured(dataUrl);

    c.toBlob(blob => { if (blob) setCapturedBlob(blob); }, 'image/jpeg', 0.88);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCaptured(ev.target?.result as string);
    reader.readAsDataURL(file);
    setCapturedBlob(file);
  };

  const discard = () => { setCaptured(null); setCapturedBlob(null); setCaption(''); };

  const publish = async () => {
    if (!capturedBlob || !signer || !pubkey) {
      toast.error('Sign in to post stories');
      return;
    }
    setPublishing(true);
    try {
      const file = capturedBlob instanceof File
        ? capturedBlob
        : new File([capturedBlob], 'story.jpg', { type: 'image/jpeg' });

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
        mediaType: 'image',
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
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${camReady ? 'opacity-100' : 'opacity-0'} ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
          />
          <canvas ref={canvasRef} className="hidden" />

          {!camReady && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 size={32} className="text-white/40 animate-spin" />
            </div>
          )}

          {/* Shutter flash */}
          {shutterAnim && <div className="absolute inset-0 bg-white opacity-60 pointer-events-none z-20" />}

          {/* Top controls */}
          <div className="absolute top-0 left-0 right-0 z-10 flex justify-between px-5 pt-14 safe-top">
            <button onClick={() => setFacingMode(m => m === 'user' ? 'environment' : 'user')}
              className="w-10 h-10 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white">
              <FlipHorizontal size={18} />
            </button>
          </div>

          {/* Bottom controls */}
          <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-around px-10 pb-24 safe-bottom">
            {/* Gallery */}
            <button onClick={() => fileRef.current?.click()}
              className="w-12 h-12 rounded-xl overflow-hidden bg-white/20 backdrop-blur flex items-center justify-center border border-white/20">
              <ImagePlus size={20} className="text-white" />
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFile} />

            {/* Shutter */}
            <button
              onClick={capture}
              className={`w-20 h-20 rounded-full border-4 border-white flex items-center justify-center transition-transform active:scale-90 ${shutterAnim ? 'shutter-press' : ''}`}
              style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)' }}
            >
              <div className="w-14 h-14 rounded-full bg-white" />
            </button>

            <div className="w-12 h-12" />
          </div>

          {/* Story label */}
          <div className="absolute bottom-10 left-0 right-0 flex justify-center z-10">
            <p className="text-white/50 text-xs tracking-widest uppercase font-display">Story</p>
          </div>
        </>
      ) : (
        /* Preview + post */
        <div className="flex flex-col h-full">
          <div className="relative flex-1">
            <img src={captured} alt="Preview" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.8) 100%)' }} />

            {/* Discard */}
            <button onClick={discard} className="absolute top-14 left-5 safe-top w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white z-10">
              <X size={20} />
            </button>

            {/* Caption */}
            <div className="absolute bottom-4 left-4 right-4 z-10">
              <input
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="Add a caption…"
                maxLength={140}
                className="w-full bg-black/40 backdrop-blur border border-white/20 rounded-2xl px-4 py-3 text-white text-sm placeholder-white/40 focus:outline-none focus:border-flare-500/60"
              />
            </div>
          </div>

          {/* Post button */}
          <div className="flex items-center justify-between px-5 py-4 safe-bottom bg-black">
            <div>
              <p className="text-white text-sm font-semibold">Post to story</p>
              <p className="text-gray-500 text-xs">Disappears in 24 hours</p>
            </div>
            <button
              onClick={publish}
              disabled={publishing}
              className="flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-white disabled:opacity-50 flare-glow"
              style={{ background: 'linear-gradient(135deg, #f97316, #fb923c)' }}
            >
              {publishing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              {publishing ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
