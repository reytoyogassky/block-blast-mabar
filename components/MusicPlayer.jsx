import { useState, useRef, useEffect, memo } from 'react';
import styles from '../styles/MusicPlayer.module.css';

export function parseUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split('?')[0];
      if (id) return { type: 'youtube', id };
    }
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return { type: 'youtube', id: v };
      const list = u.searchParams.get('list');
      if (list) return { type: 'youtube', id: '', isPlaylist: true, list };
    }
    if (u.hostname === 'open.spotify.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) return { type: 'spotify', kind: parts[0], id: parts[1] };
    }
  } catch (_) {}
  return null;
}

function elapsedSeconds(startedAt) {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
}

// ── KUNCI FIX: src di-compute SEKALI saat mount, tidak pernah berubah ──────────
// memo() + src disimpan di ref → render ulang parent tidak reload iframe
const YoutubeEmbed = memo(function YoutubeEmbed({ videoId, isPlaylist, list, startedAt }) {
  // src di-compute hanya satu kali saat komponen ini di-mount
  const srcRef = useRef(null);
  if (!srcRef.current) {
    const start = elapsedSeconds(startedAt);
    if (isPlaylist) {
      srcRef.current = `https://www.youtube-nocookie.com/embed/videoseries?list=${list}&autoplay=1&start=${start}`;
    } else {
      srcRef.current = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&loop=1&playlist=${videoId}&start=${start}`;
    }
  }
  return (
    <iframe
      src={srcRef.current}
      allow="autoplay; encrypted-media"
      allowFullScreen
      className={styles.iframe}
      title="YouTube music"
    />
  );
});

const SpotifyEmbed = memo(function SpotifyEmbed({ kind, id }) {
  const src = `https://open.spotify.com/embed/${kind}/${id}?utm_source=generator&theme=0`;
  return (
    <iframe
      src={src}
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      className={styles.iframeSpotify}
      title="Spotify music"
    />
  );
});

export default function MusicPlayer({
  isHost = false,
  roomMusicUrl = '',
  musicStartedAt = null,
  onSaveUrl,
}) {
  const [inputUrl, setInputUrl]   = useState('');
  const [editMode, setEditMode]   = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [syncFlash, setSyncFlash] = useState(false);

  // syncKey adalah SATU-SATUNYA cara remount iframe.
  // Hanya naik saat URL atau startedAt BENAR-BENAR berubah dari nilai sebelumnya.
  const [syncKey, setSyncKey] = useState(() => `${roomMusicUrl}__${musicStartedAt}`);
  const prevSyncRef = useRef(`${roomMusicUrl}__${musicStartedAt}`);

  useEffect(() => {
    const next = `${roomMusicUrl}__${musicStartedAt}`;
    if (next !== prevSyncRef.current) {
      prevSyncRef.current = next;
      setSyncKey(next);
    }
    // roomMusicUrl dan musicStartedAt adalah string/null — aman di dep array
  }, [roomMusicUrl, musicStartedAt]);

  const parsed = parseUrl(roomMusicUrl);

  function handleSave() {
    if (!inputUrl.trim()) return;
    if (onSaveUrl) onSaveUrl(inputUrl.trim(), new Date().toISOString());
    setEditMode(false);
  }

  function handleResync() {
    if (onSaveUrl) onSaveUrl(roomMusicUrl, new Date().toISOString());
    setSyncFlash(true);
    setTimeout(() => setSyncFlash(false), 900);
  }

  function handleClear() {
    if (onSaveUrl) onSaveUrl('', null);
    setInputUrl('');
    setEditMode(false);
  }

  const typeLabel = parsed?.type === 'youtube' ? '▶ YouTube'
    : parsed?.type === 'spotify' ? '🎵 Spotify'
    : null;

  return (
    <div className={`${styles.wrap} ${syncFlash ? styles.syncFlash : ''}`}>
      <div className={styles.bar}>
        <span className={styles.barTitle}>
          🎵 Musik Room
          {typeLabel && <span className={styles.typeTag}>{typeLabel}</span>}
        </span>
        <div className={styles.barActions}>
          {isHost && parsed?.type === 'youtube' && !editMode && (
            <button className={styles.syncBtn} onClick={handleResync} title="Sync posisi ke semua pemain">
              🔄 Sync
            </button>
          )}
          {isHost && (
            <button
              className={styles.editBtn}
              onClick={() => { setInputUrl(roomMusicUrl); setEditMode(e => !e); }}
            >
              {editMode ? '✕' : '✏️'}
            </button>
          )}
          <button className={styles.collapseBtn} onClick={() => setCollapsed(c => !c)}>
            {collapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>

      {isHost && editMode && (
        <div className={styles.inputWrap}>
          <input
            className={styles.urlInput}
            placeholder="Paste link YouTube atau Spotify..."
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditMode(false); }}
            autoFocus
          />
          <div className={styles.inputHint}>
            YouTube: semua pemain sync ke posisi yang sama · Spotify: tanpa sync posisi
          </div>
          <div className={styles.inputBtns}>
            <button className={styles.saveBtn} onClick={handleSave}>▶ Pasang &amp; Sync</button>
            {roomMusicUrl && <button className={styles.clearBtn} onClick={handleClear}>✕ Hapus</button>}
            <button className={styles.cancelBtn} onClick={() => setEditMode(false)}>Batal</button>
          </div>
        </div>
      )}

      {!isHost && parsed?.type === 'youtube' && musicStartedAt && !collapsed && (
        <div className={styles.syncInfo}>
          🔄 Musik disinkronkan dari host
        </div>
      )}

      {!collapsed && parsed && (
        <div className={styles.playerWrap}>
          {parsed.type === 'youtube' && (
            // key=syncKey → remount HANYA saat host ganti URL atau klik Sync
            <YoutubeEmbed
              key={syncKey}
              videoId={parsed.id}
              isPlaylist={parsed.isPlaylist}
              list={parsed.list}
              startedAt={musicStartedAt}
            />
          )}
          {parsed.type === 'spotify' && (
            <SpotifyEmbed key={parsed.id} kind={parsed.kind} id={parsed.id} />
          )}
        </div>
      )}

      {!collapsed && !parsed && !editMode && (
        <div className={styles.empty}>
          {isHost
            ? <span>Belum ada musik. Klik ✏️ untuk pasang lagu YouTube/Spotify.</span>
            : <span>Host belum memasang musik.</span>
          }
        </div>
      )}

      {!collapsed && roomMusicUrl && !parsed && (
        <div className={styles.invalid}>⚠️ URL tidak dikenali. Gunakan link YouTube atau Spotify.</div>
      )}
    </div>
  );
}