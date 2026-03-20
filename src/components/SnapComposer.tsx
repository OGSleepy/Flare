import React, { useRef, useState, useEffect, useCallback } from 'react';
import { X, Zap, FlipHorizontal, ImagePlus, Timer, Loader2, Repeat } from 'lucide-react';
import { uploadFile } from '@/lib/upload';
import { sendSnap } from '@/lib/nip17';
import type { NostrSigner } from '@nostrify/nostrify';
import { toast } from 'sonner';

interface SnapComposerProps {
  recipientPubkey: string;
  recipientName: string;
  signer: NostrSigner | null;
  onClose: () => void;
  onSent: (mediaUrl: string, mediaType: 'image' | 'video', viewOnce: boolean, caption?: string) => void;
}

export const SnapComposer: React.FC<SnapComposerProps> = ({
  recipientPubkey, recipientName, signer, onClose, onSent,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [camReady, setCamReady] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);

  const [captured, setCaptured] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [viewOnce, setViewOnce] = useState(true); // default: view once
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);

  // Start camera
  useEffect(() => {
    let cancelled = false;
    setCamReady(false);
    const start = async () => {
      try {
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
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
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [facingMode, cameraKey]);

  const doCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    if (facingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setCaptured(dataUrl);
    setIsVideo(false);
    canvas.toBlob(blob => { if (blob) setCapturedBlob(blob); }, 'image/jpeg', 0.88);
  }, [facingMode]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !camReady) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setCaptured(url);
        setCapturedBlob(blob);
        setIsVideo(true);
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordSeconds(0);
      recordIntervalRef.current = setInterval(() => {
        setRecordSeconds(s => {
          if (s >= 29) { stopRecording(); return s; }
          return s + 1;
        });
      }, 1000);
    } catch { toast.error('Recording not supported'); }
  }, [camReady]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    if (recordIntervalRef.current) { clearInterval(recordIntervalRef.current); recordIntervalRef.current = null; }
    setIsRecording(false);
    setRecordSeconds(0);
  }, []);

  const handleShutterDown = useCallback(() => {
    if (!camReady) return;
    holdTimerRef.current = setTimeout(() => { holdTimerRef.current = null; startRecording(); }, 300);
  }, [camReady, startRecording]);

  const handleShutterUp = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      doCapture();
    } else if (isRecording) {
      stopRecording();
    }
  }, [isRecording, doCapture, stopRecording]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCaptured(ev.target?.result as string);
    reader.readAsDataURL(file);
    setCapturedBlob(file);
    setIsVideo(file.type.startsWith('video/'));
    e.target.value = '';
  };

  const discard = () => {
    setCaptured(null); setCapturedBlob(null); setIsVideo(false); setCaption('');
    setCameraKey(k => k + 1);
  };

  const handleSend = async () => {
    if (!capturedBlob || !signer) return;
    setSending(true);
    try {
      const ext = isVideo ? 'mp4' : 'jpg';
      const mime = isVideo ? (capturedBlob.type || 'video/mp4') : 'image/jpeg';
      const file = capturedBlob instanceof File ? capturedBlob : new File([capturedBlob], `snap.${ext}`, { type: mime });
      const upload = await uploadFile(file, signer as any);
      await sendSnap(signer as any, recipientPubkey, upload.url, isVideo ? 'video' : 'image', viewOnce, caption || undefined);
      onSent(upload.url, isVideo ? 'video' : 'image', viewOnce, caption || undefined);
      toast.success(viewOnce ? '👻 Snap sent — view once' : '📸 Snap sent');
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send snap');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-12 pb-3 safe-top z-10">
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white border border-white/10">
          <X size={18} />
        </button>
        <p className="text-white text-sm font-semibold">Snap to {recipientName}</p>
        <button onClick={() => { setFacingMode(m => m === 'user' ? 'environment' : 'user'); setCameraKey(k => k + 1); }}
          className="w-9 h-9 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white border border-white/10">
          <FlipHorizontal size={18} />
        </button>
      </div>

      {!captured ? (
        <>
          {/* Viewfinder */}
          <div className="absolute inset-0">
            <video ref={videoRef} autoPlay playsInline muted
              className={`w-full h-full transition-opacity duration-300 ${camReady ? 'opacity-100' : 'opacity-0'}`}
              style={{ objectFit: 'cover', transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }} />
          </div>
          <canvas ref={canvasRef} className="hidden" />

          {!camReady && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 size={28} className="text-white/40 animate-spin" />
            </div>
          )}

          {/* Recording indicator */}
          {isRecording && (
            <div className="absolute top-24 left-0 right-0 flex justify-center z-10">
              <div className="flex items-center gap-2 bg-black/60 backdrop-blur rounded-full px-4 py-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-semibold">{recordSeconds}s</span>
              </div>
            </div>
          )}

          {/* Bottom controls */}
          <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-around px-8 pb-16 safe-bottom">
            {/* Gallery */}
            <button onClick={() => fileRef.current?.click()}
              className="w-12 h-12 rounded-2xl bg-black/60 backdrop-blur flex items-center justify-center border border-white/20">
              <ImagePlus size={20} className="text-white" />
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFile} />

            {/* Shutter */}
            <button
              onPointerDown={handleShutterDown}
              onPointerUp={handleShutterUp}
              onPointerLeave={handleShutterUp}
              disabled={!camReady}
              style={{ touchAction: 'none' }}
              className="disabled:opacity-40"
            >
              <div className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ boxShadow: isRecording ? '0 0 0 4px rgba(239,68,68,0.9)' : '0 0 0 4px rgba(255,255,255,0.9)' }}>
                <div className={`rounded-full transition-all duration-150 ${isRecording ? 'w-10 h-10 rounded-xl bg-red-500' : 'w-[62px] h-[62px] bg-white'}`} />
              </div>
            </button>

            <div className="w-12 h-12" />
          </div>

          <p className="absolute bottom-6 left-0 right-0 text-center text-white/30 text-[9px] tracking-wider uppercase z-10">
            Tap photo · Hold video
          </p>
        </>
      ) : (
        /* Preview */
        <div className="flex flex-col h-full">
          <div className="relative flex-1 overflow-hidden">
            {isVideo
              ? <video src={captured} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" />
              : <img src={captured} alt="" className="absolute inset-0 w-full h-full object-cover" />
            }
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.85) 100%)' }} />

            {/* Retake */}
            <button onClick={discard}
              className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center text-white border border-white/10 z-10">
              <Repeat size={18} />
            </button>
          </div>

          {/* Send options */}
          <div className="bg-black flex-shrink-0 px-4 pt-4 space-y-3"
            style={{ paddingBottom: 'calc(1rem + 64px + env(safe-area-inset-bottom, 0px))' }}>

            {/* Caption */}
            <input
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Add a caption…"
              maxLength={100}
              className="w-full bg-surface-raised border border-[var(--border)] rounded-2xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/50"
            />

            {/* View Once toggle */}
            <div className="flex items-center justify-between bg-surface-raised rounded-2xl px-4 py-3 border border-[var(--border)]">
              <div>
                <p className="text-white text-sm font-semibold">
                  {viewOnce ? '👻 View Once' : '💬 Keep in Chat'}
                </p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {viewOnce ? 'Disappears after they open it' : 'Stays in the chat thread'}
                </p>
              </div>
              <button
                onClick={() => setViewOnce(v => !v)}
                className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${viewOnce ? 'bg-flare-500' : 'bg-surface-overlay'}`}
              >
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${viewOnce ? 'translate-x-6' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={sending}
              className="w-full py-3.5 rounded-2xl font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2 flare-glow"
              style={{ background: 'linear-gradient(135deg, #f97316, #fb923c)' }}
            >
              {sending
                ? <Loader2 size={16} className="animate-spin" />
                : <Zap size={16} />
              }
              {sending ? 'Sending…' : `Send to ${recipientName}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
