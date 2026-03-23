import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  X, Type, Pen, Smile, Zap, Send, MessageCircle, ChevronDown,
  Loader2, Trash2, Check,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { getPool, STORY_KIND, STORY_EXPIRY, unixNow, shortKey } from '@/lib/nostr';
import { uploadFile } from '@/lib/upload';
import { sendDM } from '@/lib/nip17';
import * as nip19 from 'nostr-tools/nip19';
import type { NostrSigner } from '@nostrify/nostrify';
import type { FlareStory } from '@/types';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────
type Tool = 'none' | 'text' | 'draw' | 'stickers';

interface TextLayer {
  id: string;
  text: string;
  color: string;
  fontSize: number;
  x: number; // % of container width
  y: number; // % of container height
}

interface DrawPoint { x: number; y: number; }
interface DrawPath { points: DrawPoint[]; color: string; size: number; }

interface StoryEditorProps {
  imageDataUrl: string;
  imageBlob: Blob;
  onDiscard: () => void;
  signer: NostrSigner | null;
}

// ─── Sticker grid ─────────────────────────────────────────────────────────────
const STICKERS = ['🔥','😂','❤️','🥶','💀','🤣','😍','🙏','👀','💯','🫡','🤯','😤','🥹','🫶','⚡','✨','🎉','👑','💅'];

// ─── Text colors ──────────────────────────────────────────────────────────────
const TEXT_COLORS = ['#FFFFFF','#000000','#FF6B35','#FFD700','#00FF88','#00D4FF','#FF4FFF','#FF4040'];

export const StoryEditor: React.FC<StoryEditorProps> = ({ imageDataUrl, imageBlob, onDiscard, signer }) => {
  const pubkey = useAppStore(s => s.pubkey);
  const addStory = useAppStore(s => s.addStory);
  const profiles = useAppStore(s => s.profiles);
  const followList = useAppStore(s => s.followList);
  const conversations = useAppStore(s => s.conversations);
  const addMessage = useAppStore(s => s.addMessage);

  // Detect media type — GIFs and videos both skip canvas compositing
  const isVideo = imageBlob.type.startsWith('video/') ||
    (imageDataUrl.startsWith('blob:') && !imageBlob.type.includes('gif') && !imageBlob.type.includes('image'));
  const isGif = imageBlob.type === 'image/gif' || /\.gif(\?|$)/i.test(imageDataUrl);
  const skipCanvas = isVideo || isGif;

  // ── Tool state ──────────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<Tool>('none');
  const [contactSearch, setContactSearch] = useState('');
  const [manualNpub, setManualNpub] = useState('');

  // ── Text layers ─────────────────────────────────────────────────────────────
  const [textLayers, setTextLayers] = useState<TextLayer[]>([]);
  const [editingText, setEditingText] = useState<string>('');
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [fontSize, setFontSize] = useState(32);
  const [draggingTextId, setDraggingTextId] = useState<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Draw state ───────────────────────────────────────────────────────────────
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [paths, setPaths] = useState<DrawPath[]>([]);
  const [currentPath, setCurrentPath] = useState<DrawPoint[]>([]);
  const [drawColor, setDrawColor] = useState('#FF6B35');
  const [brushSize, setBrushSize] = useState(4);
  const isDrawing = useRef(false);

  // ── Sticker state ────────────────────────────────────────────────────────────
  const [stickerLayers, setStickerLayers] = useState<{ id: string; emoji: string; x: number; y: number; size: number }[]>([]);

  // ── Send state ───────────────────────────────────────────────────────────────
  const [showSendSheet, setShowSendSheet] = useState(false);
  const [sendMode, setSendMode] = useState<'story' | 'dm' | 'both' | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [publishing, setPublishing] = useState(false);

  // ── Composite canvas (for final export) ─────────────────────────────────────
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);

  // Redraw draw canvas when paths change
  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    [...paths, ...(currentPath.length > 1 ? [{ points: currentPath, color: drawColor, size: brushSize }] : [])].forEach(path => {
      if (path.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(path.points[0].x, path.points[0].y);
      path.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    });
  }, [paths, currentPath, drawColor, brushSize]);

  // ── Draw handlers ─────────────────────────────────────────────────────────
  const getCanvasPoint = (e: React.PointerEvent): DrawPoint => {
    const canvas = drawCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const onDrawStart = (e: React.PointerEvent) => {
    if (activeTool !== 'draw') return;
    e.preventDefault();
    isDrawing.current = true;
    setCurrentPath([getCanvasPoint(e)]);
  };

  const onDrawMove = (e: React.PointerEvent) => {
    if (!isDrawing.current || activeTool !== 'draw') return;
    e.preventDefault();
    setCurrentPath(p => [...p, getCanvasPoint(e)]);
  };

  const onDrawEnd = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    if (currentPath.length > 1) {
      setPaths(p => [...p, { points: currentPath, color: drawColor, size: brushSize }]);
    }
    setCurrentPath([]);
  };

  // ── Text drag handlers ────────────────────────────────────────────────────
  const onTextPointerDown = (e: React.PointerEvent, id: string) => {
    if (activeTool !== 'none' && activeTool !== 'text') return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingTextId(id);
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const layer = textLayers.find(t => t.id === id)!;
    dragOffsetRef.current = {
      x: e.clientX - rect.left - (layer.x / 100) * rect.width,
      y: e.clientY - rect.top - (layer.y / 100) * rect.height,
    };
  };

  const onTextPointerMove = (e: React.PointerEvent) => {
    if (!draggingTextId) return;
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left - dragOffsetRef.current.x) / rect.width) * 100;
    const y = ((e.clientY - rect.top - dragOffsetRef.current.y) / rect.height) * 100;
    setTextLayers(layers => layers.map(l => l.id === draggingTextId
      ? { ...l, x: Math.min(90, Math.max(0, x)), y: Math.min(90, Math.max(0, y)) }
      : l
    ));
  };

  const onTextPointerUp = () => setDraggingTextId(null);

  const addTextLayer = () => {
    if (!editingText.trim()) return;
    setTextLayers(l => [...l, {
      id: Date.now().toString(),
      text: editingText.trim(),
      color: textColor,
      fontSize,
      x: 50 - (editingText.length * 0.8),
      y: 45,
    }]);
    setEditingText('');
    setActiveTool('none');
  };

  // ── Composite & publish ───────────────────────────────────────────────────
  const buildFinalBlob = (): Promise<Blob> => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Draw paths
      const drawCanvas = drawCanvasRef.current;
      if (drawCanvas && paths.length > 0) {
        ctx.drawImage(drawCanvas, 0, 0, img.width, img.height);
      }

      // Draw text layers
      const container = containerRef.current;
      if (container) {
        const { width: cw, height: ch } = container.getBoundingClientRect();
        textLayers.forEach(layer => {
          const x = (layer.x / 100) * img.width;
          const y = (layer.y / 100) * img.height;
          const scaledSize = (layer.fontSize / ch) * img.height;
          ctx.font = `bold ${scaledSize}px Syne, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = layer.color;
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.lineWidth = scaledSize * 0.04;
          ctx.strokeText(layer.text, x, y);
          ctx.fillText(layer.text, x, y);
        });

        // Draw stickers
        stickerLayers.forEach(s => {
          const x = (s.x / 100) * img.width;
          const y = (s.y / 100) * img.height;
          const size = (s.size / ch) * img.height;
          ctx.font = `${size}px serif`;
          ctx.textAlign = 'center';
          ctx.fillText(s.emoji, x, y);
        });
      }

      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas export failed'));
      }, 'image/jpeg', 0.9);
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });

  const publish = async (modeOverride?: 'story' | 'dm' | 'both') => {
    if (!signer || !pubkey) { toast.error('Sign in to post'); return; }
    const mode = modeOverride ?? sendMode;
    if (!mode) { toast.error('Choose where to send'); return; }
    setPublishing(true);
    try {
      // GIFs and videos skip canvas compositing — canvas flattens GIFs to a single static frame
      const finalBlob = skipCanvas ? imageBlob : await buildFinalBlob();
      const ext = isVideo ? (imageBlob.type.includes('webm') ? 'webm' : 'mp4') : isGif ? 'gif' : 'jpg';
      const mime = isVideo ? (imageBlob.type || 'video/mp4') : isGif ? 'image/gif' : 'image/jpeg';
      const file = new File([finalBlob], `story.${ext}`, { type: mime });
      const upload = await uploadFile(file, signer as any);
      const pool = getPool();
      const now = unixNow();

      if (mode === 'story' || mode === 'both') {
        const event = await (signer as any).signEvent({
          kind: STORY_KIND, content: caption, created_at: now,
          tags: [
            ['d', `story-${now}-${Math.random().toString(36).slice(2, 8)}`],
            ['url', upload.url],
            ['m', file.type],
            ['x', upload.sha256],
            ['expiration', String(now + STORY_EXPIRY)],
            ...(caption ? [['alt', caption]] : []),
          ],
        });
        await pool.event(event);
        const story: FlareStory = {
          id: event.id, pubkey, mediaUrl: upload.url, mediaType: isVideo ? 'video' : 'image',
          caption: caption || undefined, created_at: now, expires_at: now + STORY_EXPIRY, tags: event.tags,
        };
        addStory(story);
        toast.success('Story posted 🔥');
      }

      if ((mode === 'dm' || mode === 'both') && selectedContacts.length > 0) {
        const dmContent = caption
          ? `${caption}\n\n${upload.url}`
          : upload.url;
        await Promise.all(selectedContacts.map(async pk => {
          await sendDM(signer as any, pk, dmContent).catch(() => {});
          // Add to local chat immediately with media preview
          const dmNow = unixNow();
          addMessage(pk, {
            id: `sent-story-${Date.now()}-${pk.slice(0, 8)}`,
            senderPubkey: pubkey,
            recipientPubkey: pk,
            content: caption || '📸 Story',
            created_at: dmNow,
            mediaUrl: upload.url,
            mediaType: isVideo ? 'video' : 'image',
            storyCaption: caption || undefined,
          });
        }));
        toast.success(`Sent to ${selectedContacts.length} ${selectedContacts.length === 1 ? 'person' : 'people'}`);
      }

      onDiscard();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to post');
    } finally {
      setPublishing(false);
    }
  };

  // ── Contacts for DM picker ─────────────────────────────────────────────────
  // Merge follow list + existing conversations, deduplicated
  const allContactPubkeys = [...new Set([...followList, ...conversations.map(c => c.pubkey)])];

  const filteredContacts = allContactPubkeys.filter(pk => {
    if (!contactSearch) return true;
    const profile = profiles.get(pk);
    const name = (profile?.display_name || profile?.name || pk).toLowerCase();
    return name.includes(contactSearch.toLowerCase()) || pk.toLowerCase().includes(contactSearch.toLowerCase());
  }).slice(0, 100);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-black">
      {/* Editor canvas area */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        onPointerMove={e => { onDrawMove(e); onTextPointerMove(e); }}
        onPointerUp={() => { onDrawEnd(); onTextPointerUp(); }}
        onPointerLeave={() => { onDrawEnd(); onTextPointerUp(); }}
      >
        {/* Base media — image or video */}
        {isVideo ? (
          <video
            src={imageDataUrl}
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <img src={imageDataUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}

        {/* Hide draw/text/sticker tools for video/GIF — canvas compositing not supported */}
        {(isVideo || isGif) && (
          <div className="absolute top-14 right-3 safe-top z-20">
            <div className="bg-black/60 backdrop-blur rounded-xl px-3 py-2 border border-white/10">
              <p className="text-white/50 text-xs">{isGif ? 'GIF — no edits' : 'Add text after recording'}</p>
            </div>
          </div>
        )}

        {/* Draw canvas overlay */}
        <canvas
          ref={drawCanvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none', cursor: activeTool === 'draw' ? 'crosshair' : 'default' }}
          onPointerDown={onDrawStart}
          onPointerMove={onDrawMove}
          onPointerUp={onDrawEnd}
          onPointerLeave={onDrawEnd}
        />

        {/* Text layers */}
        {textLayers.map(layer => (
          <div
            key={layer.id}
            className="absolute select-none"
            style={{
              left: `${layer.x}%`, top: `${layer.y}%`,
              color: layer.color,
              fontSize: layer.fontSize,
              fontFamily: 'Syne, sans-serif',
              fontWeight: 800,
              textShadow: '0 0 8px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.8)',
              transform: 'translate(-50%, -50%)',
              whiteSpace: 'nowrap',
              cursor: 'grab',
              touchAction: 'none',
              zIndex: 10,
            }}
            onPointerDown={e => onTextPointerDown(e, layer.id)}
          >
            {layer.text}
          </div>
        ))}

        {/* Sticker layers */}
        {stickerLayers.map(s => (
          <div
            key={s.id}
            className="absolute select-none"
            style={{
              left: `${s.x}%`, top: `${s.y}%`,
              fontSize: s.size,
              transform: 'translate(-50%, -50%)',
              cursor: 'grab',
              touchAction: 'none',
              zIndex: 10,
            }}
          >
            {s.emoji}
          </div>
        ))}

        {/* Discard button */}
        <button
          onClick={onDiscard}
          className="absolute top-14 left-4 safe-top z-20 w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center text-white border border-white/10"
        >
          <X size={20} />
        </button>

        {/* Right toolbar */}
        <div className="absolute top-14 right-3 safe-top z-20 flex flex-col gap-3">
          {[
            { id: 'text' as Tool, icon: <Type size={20} />, label: 'Text' },
            { id: 'draw' as Tool, icon: <Pen size={20} />, label: 'Draw' },
            { id: 'stickers' as Tool, icon: <Smile size={20} />, label: 'Stickers' },
          ].map(({ id, icon }) => (
            <button
              key={id}
              onClick={() => setActiveTool(t => t === id ? 'none' : id)}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center border-2 shadow-lg transition-all active:scale-95 ${
                activeTool === id
                  ? 'bg-flare-500 border-flare-500 text-white'
                  : 'bg-black/70 border-white/30 text-white backdrop-blur'
              }`}
            >
              {icon}
            </button>
          ))}

          {/* Undo draw */}
          {paths.length > 0 && (
            <button
              onClick={() => setPaths(p => p.slice(0, -1))}
              className="w-12 h-12 rounded-2xl bg-black/70 border-2 border-white/30 backdrop-blur flex items-center justify-center text-white shadow-lg active:scale-95"
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>

        {/* ── Text input panel ── */}
        {activeTool === 'text' && (
          <div className="absolute inset-x-0 bottom-0 z-30 bg-black/90 backdrop-blur p-4 space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {TEXT_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setTextColor(c)}
                  className="w-8 h-8 rounded-full flex-shrink-0 border-2 transition-transform active:scale-90"
                  style={{ background: c, borderColor: textColor === c ? 'white' : 'transparent' }}
                />
              ))}
              <input type="range" min={20} max={64} value={fontSize}
                onChange={e => setFontSize(parseInt(e.target.value))}
                className="flex-1 accent-flare-500 ml-2" />
            </div>
            <div className="flex gap-2">
              <input
                autoFocus
                value={editingText}
                onChange={e => setEditingText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTextLayer()}
                placeholder="Type something…"
                className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/40 focus:outline-none focus:border-flare-500/60"
                style={{ color: textColor }}
              />
              <button onClick={addTextLayer} disabled={!editingText.trim()}
                className="w-10 h-10 rounded-xl bg-flare-500 flex items-center justify-center disabled:opacity-40">
                <Check size={18} className="text-white" />
              </button>
            </div>
          </div>
        )}

        {/* ── Draw toolbar ── */}
        {activeTool === 'draw' && (
          <div className="absolute inset-x-0 bottom-0 z-30 bg-black/90 backdrop-blur px-4 py-3 flex items-center gap-3">
            <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {TEXT_COLORS.map(c => (
                <button key={c} onClick={() => setDrawColor(c)}
                  className="w-8 h-8 rounded-full flex-shrink-0 border-2 transition-transform active:scale-90"
                  style={{ background: c, borderColor: drawColor === c ? 'white' : 'transparent' }} />
              ))}
            </div>
            <input type="range" min={2} max={24} value={brushSize}
              onChange={e => setBrushSize(parseInt(e.target.value))}
              className="flex-1 accent-flare-500" />
            <div className="rounded-full bg-white flex-shrink-0"
              style={{ width: brushSize * 2, height: brushSize * 2, backgroundColor: drawColor }} />
          </div>
        )}

        {/* ── Sticker picker ── */}
        {activeTool === 'stickers' && (
          <div className="absolute inset-x-0 bottom-0 z-30 bg-black/90 backdrop-blur p-4">
            <div className="grid grid-cols-10 gap-2">
              {STICKERS.map(emoji => (
                <button key={emoji} onClick={() => {
                  setStickerLayers(s => [...s, { id: Date.now().toString(), emoji, x: 50, y: 50, size: 40 }]);
                  setActiveTool('none');
                }}
                  className="text-3xl active:scale-90 transition-transform"
                >{emoji}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom send bar ── */}
      <div
        className="bg-black flex-shrink-0 px-4 pt-3 space-y-3"
        style={{ paddingBottom: 'calc(1rem + 64px + env(safe-area-inset-bottom, 0px))' }}
      >
        <input
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder="Add a caption…"
          maxLength={140}
          className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-flare-500/50"
        />
        <div className="flex gap-2">
          <button
            onClick={() => publish('story')}
            disabled={publishing}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white disabled:opacity-40 flare-glow"
            style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)' }}
          >
            {publishing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            <span className="text-sm">My Story</span>
          </button>
          <button
            onClick={() => setShowSendSheet(true)}
            disabled={publishing}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white bg-surface-overlay border border-white/10 disabled:opacity-40"
          >
            <Send size={16} />
            <span className="text-sm">Send To</span>
          </button>
        </div>
      </div>

      {/* ── Send To sheet ── */}
      {showSendSheet && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSendSheet(false)} />
          <div className="relative bg-surface rounded-t-3xl px-5 pt-4 animate-slide-up"
            style={{ paddingBottom: 'calc(2rem + 64px + env(safe-area-inset-bottom, 0px))' }}>
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-5" />
            <h3 className="font-display font-bold text-white text-lg mb-4">Send to</h3>

            {/* Send options */}
            <div className="space-y-2 mb-5">
              {[
                { id: 'story', label: 'My Story', sub: 'Visible to everyone for 24h', icon: <Zap size={18} className="text-flare-500" /> },
                { id: 'dm', label: 'Send to DM only', sub: 'Private — select recipients below', icon: <MessageCircle size={18} className="text-flare-500" /> },
                { id: 'both', label: 'Story + DM', sub: 'Post publicly and notify contacts', icon: <Send size={18} className="text-flare-500" /> },
              ].map(opt => (
                <button key={opt.id} onClick={() => setSendMode(opt.id as any)}
                  className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all ${
                    sendMode === opt.id ? 'border-flare-500 bg-flare-500/10' : 'border-white/10 bg-surface-raised'
                  }`}>
                  <div className="w-9 h-9 rounded-xl bg-surface-overlay flex items-center justify-center flex-shrink-0">{opt.icon}</div>
                  <div className="text-left">
                    <p className="text-white text-sm font-semibold">{opt.label}</p>
                    <p className="text-gray-500 text-xs">{opt.sub}</p>
                  </div>
                  {sendMode === opt.id && <Check size={16} className="text-flare-500 ml-auto" />}
                </button>
              ))}
            </div>

            {/* Contact picker for DM modes */}
            {(sendMode === 'dm' || sendMode === 'both') && (
              <div className="space-y-3">
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Send to</p>

                {/* Search bar */}
                <input
                  value={contactSearch}
                  onChange={e => setContactSearch(e.target.value)}
                  placeholder="Search by name or npub…"
                  className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/50"
                />

                {/* Follow list grid */}
                {filteredContacts.length > 0 ? (
                  <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {filteredContacts.map(pk => {
                      const profile = profiles.get(pk);
                      const name = profile?.display_name || profile?.name || shortKey(pk);
                      const selected = selectedContacts.includes(pk);
                      return (
                        <button key={pk}
                          onClick={() => setSelectedContacts(c =>
                            c.includes(pk) ? c.filter(p => p !== pk) : [...c, pk]
                          )}
                          className="flex flex-col items-center gap-1 flex-shrink-0">
                          <div className={`w-12 h-12 rounded-full overflow-hidden border-2 transition-all ${selected ? 'border-flare-500 shadow-lg shadow-flare-500/30' : 'border-transparent'}`}>
                            {profile?.picture
                              ? <img src={profile.picture} alt={name} className="w-full h-full object-cover" />
                              : <div className="w-full h-full bg-surface-overlay flex items-center justify-center text-flare-500 font-bold text-lg">{name[0]?.toUpperCase()}</div>
                            }
                          </div>
                          <span className="text-[10px] text-gray-400 max-w-[48px] truncate text-center">{name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-gray-600 text-xs text-center py-2">
                    {contactSearch ? 'No matches found' : 'No follows loaded yet'}
                  </p>
                )}

                {/* Manual npub input */}
                <div className="flex gap-2 pt-1">
                  <input
                    value={manualNpub}
                    onChange={e => setManualNpub(e.target.value)}
                    placeholder="Or paste npub1… directly"
                    className="flex-1 bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-flare-500/50 font-mono"
                  />
                  <button
                    onClick={() => {
                      try {
                        const { type, data } = nip19.decode(manualNpub.trim());
                        if (type === 'npub') {
                          setSelectedContacts(c => c.includes(data as string) ? c : [...c, data as string]);
                          setManualNpub('');
                        }
                      } catch { /* invalid npub */ }
                    }}
                    disabled={!manualNpub.trim()}
                    className="px-3 py-2 rounded-xl bg-flare-500/20 text-flare-400 text-xs font-semibold disabled:opacity-30 border border-flare-500/30"
                  >
                    Add
                  </button>
                </div>

                {selectedContacts.length > 0 && (
                  <p className="text-flare-500 text-xs font-semibold">{selectedContacts.length} selected</p>
                )}
              </div>
            )}

            <button
              onClick={() => { setShowSendSheet(false); publish(sendMode ?? undefined); }}
              disabled={publishing || !sendMode || (sendMode === 'dm' && selectedContacts.length === 0)}
              className="w-full mt-4 py-3.5 rounded-2xl font-semibold text-white disabled:opacity-30 flare-glow"
              style={{ background: 'linear-gradient(135deg,#f97316,#fb923c)' }}
            >
              {publishing ? 'Sending…' : `Send${selectedContacts.length > 0 ? ` to ${selectedContacts.length}` : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
