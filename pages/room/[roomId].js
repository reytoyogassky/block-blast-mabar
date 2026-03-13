import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';
import {
  emptyBoard, make3Pieces, canPlace, placeOnBoard,
  findClears, clearLines, anyPieceFits, calcScore, ROWS, COLS,
} from '../../lib/gameLogic';
import {
  sfxPickup, sfxDrop, sfxClear, sfxCombo, sfxGameOver, sfxWin, sfxNoPlace,
  startBgMusic, stopBgMusic, setMuted, isMuted,
} from '../../lib/sounds';
import Board from '../../components/Board';
import PieceCanvas from '../../components/PieceCanvas';
import styles from '../../styles/Room.module.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function useWindowWidth() {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 800);
  useEffect(() => {
    const handler = () => setW(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return w;
}

function getPlayerId() {
  let id = localStorage.getItem('bb_player_id');
  if (!id) { id = Math.random().toString(36).slice(2, 12).toUpperCase(); localStorage.setItem('bb_player_id', id); }
  return id;
}

// Particle system — lightweight canvas-based burst
function spawnParticles(canvasEl, cells, cellSize, gap, pad, color) {
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');
  const particles = [];
  const STEP = cellSize + gap;

  cells.forEach(([r, c]) => {
    const cx = c * STEP + pad + cellSize / 2;
    const cy = r * STEP + pad + cellSize / 2;
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
      const speed = 2 + Math.random() * 4;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1, decay: 0.04 + Math.random() * 0.04,
        size: 3 + Math.random() * 4,
        color,
      });
    }
  });

  let frame;
  function draw() {
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    let alive = false;
    particles.forEach(p => {
      if (p.life <= 0) return;
      alive = true;
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.15; // gravity
      p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (alive) frame = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  }
  frame = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frame);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RoomPage() {
  const router = useRouter();
  const { roomId, name } = router.query;
  const windowWidth = useWindowWidth();

  const isMobile = windowWidth < 640;
  const cellSize = useMemo(() => {
    const PAD_TOTAL = 40;
    const available = isMobile
      ? windowWidth - PAD_TOTAL
      : Math.min(windowWidth / 2 - 60, 420);
    const raw = Math.floor(available / 8.7);
    return Math.max(28, Math.min(46, raw));
  }, [windowWidth, isMobile]);

  const GAP  = Math.max(2, Math.round(cellSize * 0.065));
  const STEP = cellSize + GAP;
  const PAD  = Math.round(cellSize * 0.2);
  const oppCellSize = isMobile ? Math.floor(cellSize * 0.55) : cellSize;

  // ── Game state ────────────────────────────────────────────────────────────
  const [myBoard, setMyBoard]       = useState(emptyBoard());
  const [myPieces, setMyPieces]     = useState(() => make3Pieces());
  const [myScore, setMyScore]       = useState(0);
  const [myGameOver, setMyGameOver] = useState(false);

  const [opponent, setOpponent]     = useState(null);
  const [roomStatus, setRoomStatus] = useState('waiting');
  const [players, setPlayers]       = useState([]);

  const [drag, setDrag]       = useState(null);
  const [snap, setSnap]       = useState(null);
  const [clearing, setClearing] = useState({ rows: [], cols: [] });
  const [combo, setCombo]     = useState(null);
  const [comboKey, setComboKey] = useState(0);
  const [bumping, setBumping] = useState(false);
  const [copied, setCopied]   = useState(false);

  // ── Visual effect state ───────────────────────────────────────────────────
  const [shaking, setShaking]   = useState(false);   // screen shake
  const [flashing, setFlashing] = useState(false);   // white flash on big combo
  const [mutedUI, setMutedUI]   = useState(false);   // mute button state

  // ── Refs ──────────────────────────────────────────────────────────────────
  const boardRef      = useRef(null);
  const particleRef   = useRef(null);  // canvas overlay for particles
  const playerId      = useRef('');
  const username      = useRef('');
  const musicStarted  = useRef(false);

  const boardStateRef  = useRef(myBoard);
  const piecesStateRef = useRef(myPieces);
  const scoreRef       = useRef(myScore);
  const gameOverRef    = useRef(myGameOver);
  boardStateRef.current  = myBoard;
  piecesStateRef.current = myPieces;
  scoreRef.current       = myScore;
  gameOverRef.current    = myGameOver;

  // ── Start music on first real interaction ─────────────────────────────────
  function ensureMusic() {
    if (!musicStarted.current && !isMuted()) {
      musicStarted.current = true;
      startBgMusic();
    }
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    playerId.current = getPlayerId();
    username.current = name || localStorage.getItem('bb_username') || 'Player';

    joinRoom();
    subscribeToRoom();
    subscribeToPlayers();

    const poll = setInterval(async () => {
      const { data: room } = await supabase.from('rooms').select('status').eq('id', roomId).single();
      if (!room) return;
      setRoomStatus(prev => prev !== room.status ? room.status : prev);
      if (room.status === 'waiting') fetchPlayers();
      if (room.status !== 'waiting') clearInterval(poll);
    }, 3000);

    return () => {
      clearInterval(poll);
      stopBgMusic();
      supabase.removeAllChannels();
    };
  }, [roomId]);

  // Resize particle canvas to match board
  useEffect(() => {
    if (!boardRef.current || !particleRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    particleRef.current.width  = rect.width;
    particleRef.current.height = rect.height;
  }, [cellSize]);

  async function joinRoom() {
    const pieces = make3Pieces();
    setMyPieces(pieces);
    await supabase.from('players').upsert({
      room_id: roomId, player_id: playerId.current,
      username: username.current, board: emptyBoard(),
      pieces, score: 0, is_game_over: false,
    }, { onConflict: 'room_id,player_id' });
    const { data: room } = await supabase.from('rooms').select('status').eq('id', roomId).single();
    if (room) setRoomStatus(room.status);
    await fetchPlayers();
  }

  async function fetchPlayers() {
    const { data } = await supabase.from('players').select('*').eq('room_id', roomId).order('joined_at');
    if (!data) return;
    setPlayers(data);
    const opp = data.find(p => p.player_id !== playerId.current);
    if (opp) setOpponent(opp);
    if (data.length >= 2) {
      const { data: room } = await supabase.from('rooms').select('status, host_id').eq('id', roomId).single();
      if (room?.status === 'waiting') {
        if (room.host_id === playerId.current)
          await supabase.from('rooms').update({ status: 'playing' }).eq('id', roomId);
        setRoomStatus('playing');
      } else if (room?.status) setRoomStatus(room.status);
    }
  }

  function subscribeToRoom() {
    supabase.channel(`room-${roomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        payload => setRoomStatus(payload.new.status))
      .subscribe();
  }

  function subscribeToPlayers() {
    supabase.channel(`players-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
        () => fetchPlayers())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
        payload => {
          const changed = payload.new;
          if (!changed || changed.player_id === playerId.current) return;
          setOpponent(changed);
        })
      .subscribe();
  }

  // ── Supabase sync ─────────────────────────────────────────────────────────
  const syncDebounce = useRef(null);
  function syncState(board, pieces, score, isGameOver) {
    clearTimeout(syncDebounce.current);
    syncDebounce.current = setTimeout(async () => {
      await supabase.from('players').update({
        board, pieces, score, is_game_over: isGameOver, updated_at: new Date().toISOString(),
      }).eq('room_id', roomId).eq('player_id', playerId.current);
    }, 120);
  }

  // ── DRAG ──────────────────────────────────────────────────────────────────
  function clientToCell(cx, cy) {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const x = cx - rect.left - PAD;
    const y = cy - rect.top  - PAD;
    const c = Math.round((x - cellSize / 2) / STEP);
    const r = Math.round((y - cellSize / 2) / STEP);
    return { r, c };
  }

  const startDrag = useCallback((idx, e) => {
    if (gameOverRef.current || !piecesStateRef.current[idx]) return;
    if (roomStatus !== 'playing') return;
    e.preventDefault();
    ensureMusic();
    sfxPickup();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    setDrag({ idx, x: cx, y: cy });
    setSnap(null);
  }, [roomStatus]);

  const moveDrag = useCallback((e) => {
    if (!drag) return;
    e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    setDrag(d => ({ ...d, x: cx, y: cy }));
    const cell = clientToCell(cx, cy);
    if (!cell) { setSnap(null); return; }
    const piece = piecesStateRef.current[drag.idx];
    if (!piece) { setSnap(null); return; }
    setSnap({ r: cell.r, c: cell.c, valid: canPlace(boardStateRef.current, piece.shape, cell.r, cell.c) });
  }, [drag]);

  const endDrag = useCallback((e) => {
    if (!drag) { setDrag(null); setSnap(null); return; }
    const cx = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const cy = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    const cell  = clientToCell(cx, cy);
    const piece = piecesStateRef.current[drag.idx];
    const ok    = cell && piece && canPlace(boardStateRef.current, piece.shape, cell.r, cell.c);
    const savedIdx = drag.idx;
    setDrag(null); setSnap(null);

    if (!ok) {
      sfxNoPlace();
      return;
    }

    sfxDrop();

    const board  = boardStateRef.current;
    const pieces = piecesStateRef.current;
    const placed = piece.shape.flat().filter(Boolean).length;
    const nb     = placeOnBoard(board, piece.shape, cell.r, cell.c, piece.color);
    const { rows, cols } = findClears(nb);
    const lines = rows.length + cols.length;
    const pts   = calcScore(placed, lines);
    const ns    = scoreRef.current + pts;

    setBumping(true); setTimeout(() => setBumping(false), 350);

    const np = [...pieces]; np[savedIdx] = null;
    const fp = np.every(p => !p) ? make3Pieces() : np;

    if (lines > 0) {
      // Collect cells being cleared for particle burst
      const clearCells = [];
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if ((rows.includes(r) || cols.includes(c)) && nb[r][c])
            clearCells.push([r, c]);

      sfxClear(lines);
      if (lines >= 2) {
        sfxCombo(lines);
        setCombo(`COMBO ×${lines}  +${pts}`);
        setComboKey(k => k + 1);
        // Screen shake on big combo
        setShaking(true);
        setTimeout(() => setShaking(false), 400);
        if (lines >= 3) {
          setFlashing(true);
          setTimeout(() => setFlashing(false), 180);
        }
      }

      setClearing({ rows, cols });

      // Spawn particles immediately
      spawnParticles(particleRef.current, clearCells, cellSize, GAP, PAD, piece.color.light || '#fff');

      setTimeout(() => {
        const cb = clearLines(nb, rows, cols);
        setMyBoard(cb); setClearing({ rows: [], cols: [] });
        setMyPieces(fp); setMyScore(ns);
        const over = !anyPieceFits(cb, fp);
        if (over) handleGameOver(ns, cb, fp);
        else syncState(cb, fp, ns, false);
      }, 310);
    } else {
      setMyBoard(nb); setMyPieces(fp); setMyScore(ns);
      const over = !anyPieceFits(nb, fp);
      if (over) handleGameOver(ns, nb, fp);
      else syncState(nb, fp, ns, false);
    }
  }, [drag, cellSize, GAP, PAD]);

  async function handleGameOver(finalScore, board, pieces) {
    setMyGameOver(true);
    sfxGameOver();
    syncState(board, pieces, finalScore, true);
    await supabase.from('leaderboard').insert({
      username: username.current, score: finalScore, room_id: roomId,
    });
    const { data } = await supabase.from('players').select('is_game_over').eq('room_id', roomId);
    if (data && data.every(p => p.is_game_over))
      await supabase.from('rooms').update({ status: 'finished' }).eq('id', roomId);
  }

  useEffect(() => {
    window.addEventListener('mousemove', moveDrag);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchmove', moveDrag, { passive: false });
    window.addEventListener('touchend', endDrag);
    return () => {
      window.removeEventListener('mousemove', moveDrag);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchmove', moveDrag);
      window.removeEventListener('touchend', endDrag);
    };
  }, [moveDrag, endDrag]);

  // Play win/lose SFX when game ends
  const winnerRef = useRef(null);
  const winner = useMemo(() => {
    if (roomStatus !== 'finished' && !(myGameOver && opponent?.is_game_over)) return null;
    const myS = myScore, opS = opponent?.score || 0;
    if (myS > opS) return 'you';
    if (opS > myS) return 'opponent';
    return 'draw';
  }, [roomStatus, myGameOver, opponent, myScore]);

  useEffect(() => {
    if (winner && !winnerRef.current) {
      winnerRef.current = winner;
      if (winner === 'you') sfxWin();
    }
  }, [winner]);

  // ── Ghost & display board ─────────────────────────────────────────────────
  const ghostCells = useMemo(() => {
    const s = new Set();
    if (!snap || drag === null || !myPieces[drag.idx]) return s;
    myPieces[drag.idx].shape.forEach((row, dr) =>
      row.forEach((v, dc) => { if (v) s.add(`${snap.r+dr},${snap.c+dc}`); }));
    return s;
  }, [snap, drag, myPieces]);

  const displayBoard = useMemo(() => {
    const d = myBoard.map(r => [...r]);
    if (snap && drag !== null && myPieces[drag.idx] && snap.valid) {
      const p = myPieces[drag.idx];
      p.shape.forEach((row, dr) => row.forEach((v, dc) => {
        if (v) {
          const nr = snap.r + dr, nc = snap.c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !d[nr][nc])
            d[nr][nc] = { ...p.color, ghost: true };
        }
      }));
    }
    return d;
  }, [myBoard, snap, drag, myPieces]);

  let snapBox = null;
  if (snap && drag !== null && myPieces[drag.idx]) {
    const p  = myPieces[drag.idx];
    const sw = p.shape[0].length * STEP - GAP;
    const sh = p.shape.length  * STEP - GAP;
    snapBox = (
      <div className={styles.snapRing} style={{
        left: snap.c * STEP + PAD, top: snap.r * STEP + PAD,
        width: sw, height: sh,
        borderColor: snap.valid ? 'rgba(255,255,255,0.35)' : 'rgba(255,60,60,0.6)',
        background:  snap.valid ? 'rgba(255,255,255,0.04)' : 'rgba(255,30,30,0.08)',
      }} />
    );
  }

  function copyCode() {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    });
  }

  function toggleMute() {
    const next = !mutedUI;
    setMutedUI(next);
    setMuted(next);
    if (!next) musicStarted.current = false; // allow restart
  }

  const floatPiece = drag !== null && myPieces[drag.idx];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Head><title>Block Blast Mabar — {roomId}</title></Head>

      {/* Full-screen flash overlay */}
      {flashing && <div className={styles.flashOverlay} />}

      <div className={`${styles.page} ${shaking ? styles.shake : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => router.push('/')}>← Lobby</button>
          <button className={styles.codeBtn} onClick={copyCode}>
            Room: <strong>{roomId}</strong> {copied ? '✓ Disalin!' : '📋'}
          </button>
          <div className={styles.statusBadge} data-status={roomStatus}>
            {roomStatus === 'waiting'  && '⏳ Menunggu pemain...'}
            {roomStatus === 'playing'  && '🎮 Sedang bermain'}
            {roomStatus === 'finished' && '🏁 Selesai'}
          </div>
          {/* Mute button */}
          <button className={styles.muteBtn} onClick={toggleMute} title={mutedUI ? 'Unmute' : 'Mute'}>
            {mutedUI ? '🔇' : '🔊'}
          </button>
        </div>

        <div className={styles.arena}>
          {/* MY BOARD */}
          <div className={styles.playerSection}>
            <div className={styles.playerHeader}>
              <span className={styles.playerName}>{username.current || 'Kamu'}</span>
              <span className={`${styles.scoreVal} ${bumping ? styles.bump : ''}`}>
                {myScore.toLocaleString()}
              </span>
            </div>

            <div className={styles.boardWrap} ref={boardRef}>
              <Board
                board={displayBoard}
                clearing={clearing}
                ghostCells={ghostCells}
                ghostValid={snap?.valid ?? true}
                cellSize={cellSize}
              />
              {/* Particle canvas overlay */}
              <canvas
                ref={particleRef}
                className={styles.particleCanvas}
                style={{ pointerEvents: 'none' }}
              />
              {snapBox}
              {combo && <div key={comboKey} className={styles.combo}>{combo}</div>}
              {myGameOver && (
                <div className={styles.boardOverlay}>
                  <span className={styles.overText}>GAME OVER</span>
                  <span className={styles.overScore}>{myScore.toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Tray */}
            <div className={styles.tray}>
              {myPieces.map((p, i) => {
                if (!p) return <div key={i} className={styles.slotEmpty} />;
                const lifting = drag?.idx === i;
                return (
                  <div
                    key={p.id}
                    className={`${styles.slot} ${lifting ? styles.lifting : ''}`}
                    onMouseDown={e => startDrag(i, e)}
                    onTouchStart={e => startDrag(i, e)}
                  >
                    <PieceCanvas shape={p.shape} color={p.color} maxSize={isMobile ? 62 : 78} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* VS */}
          <div className={styles.vs}>VS</div>

          {/* OPPONENT BOARD */}
          <div className={styles.playerSection}>
            {opponent ? (
              <>
                <div className={styles.playerHeader}>
                  <span className={styles.playerName}>{opponent.username}</span>
                  <span className={styles.scoreVal}>{(opponent.score || 0).toLocaleString()}</span>
                </div>
                <div className={styles.boardWrap} style={{ pointerEvents: 'none' }}>
                  <Board board={opponent.board || emptyBoard()} cellSize={oppCellSize} />
                  {opponent.is_game_over && (
                    <div className={styles.boardOverlay}>
                      <span className={styles.overText}>GAME OVER</span>
                      <span className={styles.overScore}>{(opponent.score || 0).toLocaleString()}</span>
                    </div>
                  )}
                </div>
                <div className={styles.trayMirror}>
                  {(opponent.pieces || []).map((p, i) => (
                    p
                      ? <div key={i} className={styles.slotMini}><PieceCanvas shape={p.shape} color={p.color} maxSize={isMobile ? 44 : 56} /></div>
                      : <div key={i} className={styles.slotEmpty} />
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.waitingPanel}>
                <div className={styles.waitingDot} />
                <p>Menunggu lawan...</p>
                <p className={styles.waitingHint}>Share kode room ke temanmu!</p>
                <button className={styles.shareBtn} onClick={copyCode}>
                  {copied ? '✓ Disalin!' : `Salin Kode: ${roomId}`}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Winner overlay */}
        {winner && (
          <div className={styles.winnerOverlay}>
            <div className={styles.winnerCard}>
              {winner === 'you'      && <><div className={styles.winnerEmoji}>🏆</div><div className={styles.winnerTitle}>KAMU MENANG!</div></>}
              {winner === 'opponent' && <><div className={styles.winnerEmoji}>😢</div><div className={styles.winnerTitle}>KAMU KALAH</div></>}
              {winner === 'draw'     && <><div className={styles.winnerEmoji}>🤝</div><div className={styles.winnerTitle}>SERI!</div></>}
              {winner === 'you' && <div className={styles.confetti}>{Array.from({length:16}).map((_,i)=><span key={i} style={{'--i':i}}/>)}</div>}
              <div className={styles.winnerScores}>
                <div><span className={styles.wName}>{username.current}</span><span className={styles.wScore}>{myScore.toLocaleString()}</span></div>
                {opponent && <div><span className={styles.wName}>{opponent.username}</span><span className={styles.wScore}>{(opponent.score||0).toLocaleString()}</span></div>}
              </div>
              <button className={styles.homeBtn} onClick={() => router.push('/')}>← Kembali ke Lobby</button>
            </div>
          </div>
        )}

        {/* Floating drag piece */}
        {floatPiece && (
          <div className={styles.floater} style={{ left: drag.x, top: drag.y }}>
            <PieceCanvas shape={floatPiece.shape} color={floatPiece.color} maxSize={90} />
          </div>
        )}
      </div>
    </>
  );
}import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';
import {
  emptyBoard, make3Pieces, canPlace, placeOnBoard,
  findClears, clearLines, anyPieceFits, calcScore, ROWS, COLS,
} from '../../lib/gameLogic';
import {
  sfxPickup, sfxDrop, sfxClear, sfxCombo, sfxGameOver, sfxWin, sfxNoPlace,
  startBgMusic, stopBgMusic, setMuted, isMuted,
} from '../../lib/sounds';
import Board from '../../components/Board';
import PieceCanvas from '../../components/PieceCanvas';
import styles from '../../styles/Room.module.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function useWindowWidth() {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 800);
  useEffect(() => {
    const handler = () => setW(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return w;
}

function getPlayerId() {
  let id = localStorage.getItem('bb_player_id');
  if (!id) { id = Math.random().toString(36).slice(2, 12).toUpperCase(); localStorage.setItem('bb_player_id', id); }
  return id;
}

// Particle system — lightweight canvas-based burst
function spawnParticles(canvasEl, cells, cellSize, gap, pad, color) {
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');
  const particles = [];
  const STEP = cellSize + gap;

  cells.forEach(([r, c]) => {
    const cx = c * STEP + pad + cellSize / 2;
    const cy = r * STEP + pad + cellSize / 2;
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
      const speed = 2 + Math.random() * 4;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1, decay: 0.04 + Math.random() * 0.04,
        size: 3 + Math.random() * 4,
        color,
      });
    }
  });

  let frame;
  function draw() {
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    let alive = false;
    particles.forEach(p => {
      if (p.life <= 0) return;
      alive = true;
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.15; // gravity
      p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (alive) frame = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  }
  frame = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frame);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RoomPage() {
  const router = useRouter();
  const { roomId, name } = router.query;
  const windowWidth = useWindowWidth();

  const isMobile = windowWidth < 640;
  const cellSize = useMemo(() => {
    const PAD_TOTAL = 40;
    const available = isMobile
      ? windowWidth - PAD_TOTAL
      : Math.min(windowWidth / 2 - 60, 420);
    const raw = Math.floor(available / 8.7);
    return Math.max(28, Math.min(46, raw));
  }, [windowWidth, isMobile]);

  const GAP  = Math.max(2, Math.round(cellSize * 0.065));
  const STEP = cellSize + GAP;
  const PAD  = Math.round(cellSize * 0.2);
  const oppCellSize = isMobile ? Math.floor(cellSize * 0.55) : cellSize;

  // ── Game state ────────────────────────────────────────────────────────────
  const [myBoard, setMyBoard]       = useState(emptyBoard());
  const [myPieces, setMyPieces]     = useState(() => make3Pieces());
  const [myScore, setMyScore]       = useState(0);
  const [myGameOver, setMyGameOver] = useState(false);

  const [opponent, setOpponent]     = useState(null);
  const [roomStatus, setRoomStatus] = useState('waiting');
  const [players, setPlayers]       = useState([]);

  const [drag, setDrag]       = useState(null);
  const [snap, setSnap]       = useState(null);
  const [clearing, setClearing] = useState({ rows: [], cols: [] });
  const [combo, setCombo]     = useState(null);
  const [comboKey, setComboKey] = useState(0);
  const [bumping, setBumping] = useState(false);
  const [copied, setCopied]   = useState(false);

  // ── Visual effect state ───────────────────────────────────────────────────
  const [shaking, setShaking]   = useState(false);   // screen shake
  const [flashing, setFlashing] = useState(false);   // white flash on big combo
  const [mutedUI, setMutedUI]   = useState(false);   // mute button state

  // ── Refs ──────────────────────────────────────────────────────────────────
  const boardRef      = useRef(null);
  const particleRef   = useRef(null);  // canvas overlay for particles
  const playerId      = useRef('');
  const username      = useRef('');
  const musicStarted  = useRef(false);

  const boardStateRef  = useRef(myBoard);
  const piecesStateRef = useRef(myPieces);
  const scoreRef       = useRef(myScore);
  const gameOverRef    = useRef(myGameOver);
  boardStateRef.current  = myBoard;
  piecesStateRef.current = myPieces;
  scoreRef.current       = myScore;
  gameOverRef.current    = myGameOver;

  // ── Start music on first real interaction ─────────────────────────────────
  function ensureMusic() {
    if (!musicStarted.current && !isMuted()) {
      musicStarted.current = true;
      startBgMusic();
    }
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    playerId.current = getPlayerId();
    username.current = name || localStorage.getItem('bb_username') || 'Player';

    joinRoom();
    subscribeToRoom();
    subscribeToPlayers();

    const poll = setInterval(async () => {
      const { data: room } = await supabase.from('rooms').select('status').eq('id', roomId).single();
      if (!room) return;
      setRoomStatus(prev => prev !== room.status ? room.status : prev);
      if (room.status === 'waiting') fetchPlayers();
      if (room.status !== 'waiting') clearInterval(poll);
    }, 3000);

    return () => {
      clearInterval(poll);
      stopBgMusic();
      supabase.removeAllChannels();
    };
  }, [roomId]);

  // Resize particle canvas to match board
  useEffect(() => {
    if (!boardRef.current || !particleRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    particleRef.current.width  = rect.width;
    particleRef.current.height = rect.height;
  }, [cellSize]);

  async function joinRoom() {
    const pieces = make3Pieces();
    setMyPieces(pieces);
    await supabase.from('players').upsert({
      room_id: roomId, player_id: playerId.current,
      username: username.current, board: emptyBoard(),
      pieces, score: 0, is_game_over: false,
    }, { onConflict: 'room_id,player_id' });
    const { data: room } = await supabase.from('rooms').select('status').eq('id', roomId).single();
    if (room) setRoomStatus(room.status);
    await fetchPlayers();
  }

  async function fetchPlayers() {
    const { data } = await supabase.from('players').select('*').eq('room_id', roomId).order('joined_at');
    if (!data) return;
    setPlayers(data);
    const opp = data.find(p => p.player_id !== playerId.current);
    if (opp) setOpponent(opp);
    if (data.length >= 2) {
      const { data: room } = await supabase.from('rooms').select('status, host_id').eq('id', roomId).single();
      if (room?.status === 'waiting') {
        if (room.host_id === playerId.current)
          await supabase.from('rooms').update({ status: 'playing' }).eq('id', roomId);
        setRoomStatus('playing');
      } else if (room?.status) setRoomStatus(room.status);
    }
  }

  function subscribeToRoom() {
    supabase.channel(`room-${roomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        payload => setRoomStatus(payload.new.status))
      .subscribe();
  }

  function subscribeToPlayers() {
    supabase.channel(`players-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
        () => fetchPlayers())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
        payload => {
          const changed = payload.new;
          if (!changed || changed.player_id === playerId.current) return;
          setOpponent(changed);
        })
      .subscribe();
  }

  // ── Supabase sync ─────────────────────────────────────────────────────────
  const syncDebounce = useRef(null);
  function syncState(board, pieces, score, isGameOver) {
    clearTimeout(syncDebounce.current);
    syncDebounce.current = setTimeout(async () => {
      await supabase.from('players').update({
        board, pieces, score, is_game_over: isGameOver, updated_at: new Date().toISOString(),
      }).eq('room_id', roomId).eq('player_id', playerId.current);
    }, 120);
  }

  // ── DRAG ──────────────────────────────────────────────────────────────────
  function clientToCell(cx, cy) {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const x = cx - rect.left - PAD;
    const y = cy - rect.top  - PAD;
    const c = Math.round((x - cellSize / 2) / STEP);
    const r = Math.round((y - cellSize / 2) / STEP);
    return { r, c };
  }

  const startDrag = useCallback((idx, e) => {
    if (gameOverRef.current || !piecesStateRef.current[idx]) return;
    if (roomStatus !== 'playing') return;
    e.preventDefault();
    ensureMusic();
    sfxPickup();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    setDrag({ idx, x: cx, y: cy });
    setSnap(null);
  }, [roomStatus]);

  const moveDrag = useCallback((e) => {
    if (!drag) return;
    e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    setDrag(d => ({ ...d, x: cx, y: cy }));
    const cell = clientToCell(cx, cy);
    if (!cell) { setSnap(null); return; }
    const piece = piecesStateRef.current[drag.idx];
    if (!piece) { setSnap(null); return; }
    setSnap({ r: cell.r, c: cell.c, valid: canPlace(boardStateRef.current, piece.shape, cell.r, cell.c) });
  }, [drag]);

  const endDrag = useCallback((e) => {
    if (!drag) { setDrag(null); setSnap(null); return; }
    const cx = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const cy = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    const cell  = clientToCell(cx, cy);
    const piece = piecesStateRef.current[drag.idx];
    const ok    = cell && piece && canPlace(boardStateRef.current, piece.shape, cell.r, cell.c);
    const savedIdx = drag.idx;
    setDrag(null); setSnap(null);

    if (!ok) {
      sfxNoPlace();
      return;
    }

    sfxDrop();

    const board  = boardStateRef.current;
    const pieces = piecesStateRef.current;
    const placed = piece.shape.flat().filter(Boolean).length;
    const nb     = placeOnBoard(board, piece.shape, cell.r, cell.c, piece.color);
    const { rows, cols } = findClears(nb);
    const lines = rows.length + cols.length;
    const pts   = calcScore(placed, lines);
    const ns    = scoreRef.current + pts;

    setBumping(true); setTimeout(() => setBumping(false), 350);

    const np = [...pieces]; np[savedIdx] = null;
    const fp = np.every(p => !p) ? make3Pieces() : np;

    if (lines > 0) {
      // Collect cells being cleared for particle burst
      const clearCells = [];
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if ((rows.includes(r) || cols.includes(c)) && nb[r][c])
            clearCells.push([r, c]);

      sfxClear(lines);
      if (lines >= 2) {
        sfxCombo(lines);
        setCombo(`COMBO ×${lines}  +${pts}`);
        setComboKey(k => k + 1);
        // Screen shake on big combo
        setShaking(true);
        setTimeout(() => setShaking(false), 400);
        if (lines >= 3) {
          setFlashing(true);
          setTimeout(() => setFlashing(false), 180);
        }
      }

      setClearing({ rows, cols });

      // Spawn particles immediately
      spawnParticles(particleRef.current, clearCells, cellSize, GAP, PAD, piece.color.light || '#fff');

      setTimeout(() => {
        const cb = clearLines(nb, rows, cols);
        setMyBoard(cb); setClearing({ rows: [], cols: [] });
        setMyPieces(fp); setMyScore(ns);
        const over = !anyPieceFits(cb, fp);
        if (over) handleGameOver(ns, cb, fp);
        else syncState(cb, fp, ns, false);
      }, 310);
    } else {
      setMyBoard(nb); setMyPieces(fp); setMyScore(ns);
      const over = !anyPieceFits(nb, fp);
      if (over) handleGameOver(ns, nb, fp);
      else syncState(nb, fp, ns, false);
    }
  }, [drag, cellSize, GAP, PAD]);

  async function handleGameOver(finalScore, board, pieces) {
    setMyGameOver(true);
    sfxGameOver();
    syncState(board, pieces, finalScore, true);
    await supabase.from('leaderboard').insert({
      username: username.current, score: finalScore, room_id: roomId,
    });
    const { data } = await supabase.from('players').select('is_game_over').eq('room_id', roomId);
    if (data && data.every(p => p.is_game_over))
      await supabase.from('rooms').update({ status: 'finished' }).eq('id', roomId);
  }

  useEffect(() => {
    window.addEventListener('mousemove', moveDrag);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchmove', moveDrag, { passive: false });
    window.addEventListener('touchend', endDrag);
    return () => {
      window.removeEventListener('mousemove', moveDrag);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchmove', moveDrag);
      window.removeEventListener('touchend', endDrag);
    };
  }, [moveDrag, endDrag]);

  // Play win/lose SFX when game ends
  const winnerRef = useRef(null);
  const winner = useMemo(() => {
    if (roomStatus !== 'finished' && !(myGameOver && opponent?.is_game_over)) return null;
    const myS = myScore, opS = opponent?.score || 0;
    if (myS > opS) return 'you';
    if (opS > myS) return 'opponent';
    return 'draw';
  }, [roomStatus, myGameOver, opponent, myScore]);

  useEffect(() => {
    if (winner && !winnerRef.current) {
      winnerRef.current = winner;
      if (winner === 'you') sfxWin();
    }
  }, [winner]);

  // ── Ghost & display board ─────────────────────────────────────────────────
  const ghostCells = useMemo(() => {
    const s = new Set();
    if (!snap || drag === null || !myPieces[drag.idx]) return s;
    myPieces[drag.idx].shape.forEach((row, dr) =>
      row.forEach((v, dc) => { if (v) s.add(`${snap.r+dr},${snap.c+dc}`); }));
    return s;
  }, [snap, drag, myPieces]);

  const displayBoard = useMemo(() => {
    const d = myBoard.map(r => [...r]);
    if (snap && drag !== null && myPieces[drag.idx] && snap.valid) {
      const p = myPieces[drag.idx];
      p.shape.forEach((row, dr) => row.forEach((v, dc) => {
        if (v) {
          const nr = snap.r + dr, nc = snap.c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !d[nr][nc])
            d[nr][nc] = { ...p.color, ghost: true };
        }
      }));
    }
    return d;
  }, [myBoard, snap, drag, myPieces]);

  let snapBox = null;
  if (snap && drag !== null && myPieces[drag.idx]) {
    const p  = myPieces[drag.idx];
    const sw = p.shape[0].length * STEP - GAP;
    const sh = p.shape.length  * STEP - GAP;
    snapBox = (
      <div className={styles.snapRing} style={{
        left: snap.c * STEP + PAD, top: snap.r * STEP + PAD,
        width: sw, height: sh,
        borderColor: snap.valid ? 'rgba(255,255,255,0.35)' : 'rgba(255,60,60,0.6)',
        background:  snap.valid ? 'rgba(255,255,255,0.04)' : 'rgba(255,30,30,0.08)',
      }} />
    );
  }

  function copyCode() {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    });
  }

  function toggleMute() {
    const next = !mutedUI;
    setMutedUI(next);
    setMuted(next);
    if (!next) musicStarted.current = false; // allow restart
  }

  const floatPiece = drag !== null && myPieces[drag.idx];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Head><title>Block Blast Mabar — {roomId}</title></Head>

      {/* Full-screen flash overlay */}
      {flashing && <div className={styles.flashOverlay} />}

      <div className={`${styles.page} ${shaking ? styles.shake : ''}`}>
        {/* Header */}
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => router.push('/')}>← Lobby</button>
          <button className={styles.codeBtn} onClick={copyCode}>
            Room: <strong>{roomId}</strong> {copied ? '✓ Disalin!' : '📋'}
          </button>
          <div className={styles.statusBadge} data-status={roomStatus}>
            {roomStatus === 'waiting'  && '⏳ Menunggu pemain...'}
            {roomStatus === 'playing'  && '🎮 Sedang bermain'}
            {roomStatus === 'finished' && '🏁 Selesai'}
          </div>
          {/* Mute button */}
          <button className={styles.muteBtn} onClick={toggleMute} title={mutedUI ? 'Unmute' : 'Mute'}>
            {mutedUI ? '🔇' : '🔊'}
          </button>
        </div>

        <div className={styles.arena}>
          {/* MY BOARD */}
          <div className={styles.playerSection}>
            <div className={styles.playerHeader}>
              <span className={styles.playerName}>{username.current || 'Kamu'}</span>
              <span className={`${styles.scoreVal} ${bumping ? styles.bump : ''}`}>
                {myScore.toLocaleString()}
              </span>
            </div>

            <div className={styles.boardWrap} ref={boardRef}>
              <Board
                board={displayBoard}
                clearing={clearing}
                ghostCells={ghostCells}
                ghostValid={snap?.valid ?? true}
                cellSize={cellSize}
              />
              {/* Particle canvas overlay */}
              <canvas
                ref={particleRef}
                className={styles.particleCanvas}
                style={{ pointerEvents: 'none' }}
              />
              {snapBox}
              {combo && <div key={comboKey} className={styles.combo}>{combo}</div>}
              {myGameOver && (
                <div className={styles.boardOverlay}>
                  <span className={styles.overText}>GAME OVER</span>
                  <span className={styles.overScore}>{myScore.toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Tray */}
            <div className={styles.tray}>
              {myPieces.map((p, i) => {
                if (!p) return <div key={i} className={styles.slotEmpty} />;
                const lifting = drag?.idx === i;
                return (
                  <div
                    key={p.id}
                    className={`${styles.slot} ${lifting ? styles.lifting : ''}`}
                    onMouseDown={e => startDrag(i, e)}
                    onTouchStart={e => startDrag(i, e)}
                  >
                    <PieceCanvas shape={p.shape} color={p.color} maxSize={isMobile ? 62 : 78} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* VS */}
          <div className={styles.vs}>VS</div>

          {/* OPPONENT BOARD */}
          <div className={styles.playerSection}>
            {opponent ? (
              <>
                <div className={styles.playerHeader}>
                  <span className={styles.playerName}>{opponent.username}</span>
                  <span className={styles.scoreVal}>{(opponent.score || 0).toLocaleString()}</span>
                </div>
                <div className={styles.boardWrap} style={{ pointerEvents: 'none' }}>
                  <Board board={opponent.board || emptyBoard()} cellSize={oppCellSize} />
                  {opponent.is_game_over && (
                    <div className={styles.boardOverlay}>
                      <span className={styles.overText}>GAME OVER</span>
                      <span className={styles.overScore}>{(opponent.score || 0).toLocaleString()}</span>
                    </div>
                  )}
                </div>
                <div className={styles.trayMirror}>
                  {(opponent.pieces || []).map((p, i) => (
                    p
                      ? <div key={i} className={styles.slotMini}><PieceCanvas shape={p.shape} color={p.color} maxSize={isMobile ? 44 : 56} /></div>
                      : <div key={i} className={styles.slotEmpty} />
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.waitingPanel}>
                <div className={styles.waitingDot} />
                <p>Menunggu lawan...</p>
                <p className={styles.waitingHint}>Share kode room ke temanmu!</p>
                <button className={styles.shareBtn} onClick={copyCode}>
                  {copied ? '✓ Disalin!' : `Salin Kode: ${roomId}`}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Winner overlay */}
        {winner && (
          <div className={styles.winnerOverlay}>
            <div className={styles.winnerCard}>
              {winner === 'you'      && <><div className={styles.winnerEmoji}>🏆</div><div className={styles.winnerTitle}>KAMU MENANG!</div></>}
              {winner === 'opponent' && <><div className={styles.winnerEmoji}>😢</div><div className={styles.winnerTitle}>KAMU KALAH</div></>}
              {winner === 'draw'     && <><div className={styles.winnerEmoji}>🤝</div><div className={styles.winnerTitle}>SERI!</div></>}
              {winner === 'you' && <div className={styles.confetti}>{Array.from({length:16}).map((_,i)=><span key={i} style={{'--i':i}}/>)}</div>}
              <div className={styles.winnerScores}>
                <div><span className={styles.wName}>{username.current}</span><span className={styles.wScore}>{myScore.toLocaleString()}</span></div>
                {opponent && <div><span className={styles.wName}>{opponent.username}</span><span className={styles.wScore}>{(opponent.score||0).toLocaleString()}</span></div>}
              </div>
              <button className={styles.homeBtn} onClick={() => router.push('/')}>← Kembali ke Lobby</button>
            </div>
          </div>
        )}

        {/* Floating drag piece */}
        {floatPiece && (
          <div className={styles.floater} style={{ left: drag.x, top: drag.y }}>
            <PieceCanvas shape={floatPiece.shape} color={floatPiece.color} maxSize={90} />
          </div>
        )}
      </div>
    </>
  );
}