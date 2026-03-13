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

const GAME_DURATION = 180; // 3 menit default

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

function formatTime(secs) {
  const s = Math.max(0, secs);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

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
      p.vy += 0.15;
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

export default function RoomPage() {
  const router = useRouter();
  const { roomId, name } = router.query;
  const isReady = router.isReady;
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
  const [roomData, setRoomData]     = useState(null);

  // ── Opponent drag state (broadcast realtime) ──────────────────────────────
  // oppDrag: { piece: {shape,color}, snap: {r,c} | null } | null
  const [oppDrag, setOppDrag]       = useState(null);
  const oppBoardRef                 = useRef(null);
  const broadcastChannel            = useRef(null);
  const dragBroadcastThrottle       = useRef(null);

  // ── Timer state ───────────────────────────────────────────────────────────
  const [timeLeft, setTimeLeft]     = useState(GAME_DURATION);
  const [gameStartAt, setGameStartAt] = useState(null);
  const timerRef                    = useRef(null);

  // ── Duel scoreboard ───────────────────────────────────────────────────────
  const [showScoreboard, setShowScoreboard] = useState(false);

  // ── Rematch state ─────────────────────────────────────────────────────────
  const [wantRematch, setWantRematch]   = useState(false);
  const [oppWantRematch, setOppWantRematch] = useState(false);

  // ── Drag/visual state ─────────────────────────────────────────────────────
  const [drag, setDrag]       = useState(null);
  const [snap, setSnap]       = useState(null);
  const [clearing, setClearing] = useState({ rows: [], cols: [] });
  const [combo, setCombo]     = useState(null);
  const [comboKey, setComboKey] = useState(0);
  const [bumping, setBumping] = useState(false);
  const [copied, setCopied]   = useState(false);
  const [shaking, setShaking]   = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [mutedUI, setMutedUI]   = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const boardRef      = useRef(null);
  const particleRef   = useRef(null);
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

  function ensureMusic() {
    if (!musicStarted.current && !isMuted()) {
      musicStarted.current = true;
      startBgMusic();
    }
  }

  // ── Timer logic ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (roomStatus !== 'playing' || !gameStartAt) return;

    function tick() {
      const elapsed = Math.floor((Date.now() - new Date(gameStartAt).getTime()) / 1000);
      const remaining = Math.max(0, GAME_DURATION - elapsed);
      setTimeLeft(remaining);

      if (remaining <= 0 && !gameOverRef.current) {
        // Time's up — trigger game over for this player
        handleGameOver(scoreRef.current, boardStateRef.current, piecesStateRef.current, true);
      }
    }

    tick();
    timerRef.current = setInterval(tick, 500);
    return () => clearInterval(timerRef.current);
  }, [roomStatus, gameStartAt]);

  // ── INIT ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isReady || !roomId) return;
    playerId.current = getPlayerId();
    username.current = name || localStorage.getItem('bb_username') || 'Player';

    joinRoom();
    subscribeToRoom();
    subscribeToPlayers();
    subscribeToDragBroadcast();

    const poll = setInterval(async () => {
      const { data: room } = await supabase.from('rooms').select('*').eq('id', roomId).single();
      if (!room) return;
      setRoomStatus(prev => prev !== room.status ? room.status : prev);
      setRoomData(room);
      if (room.game_start_at) setGameStartAt(room.game_start_at);
      if (room.status === 'waiting') fetchPlayers();
      if (room.status !== 'waiting') clearInterval(poll);
    }, 3000);

    return () => {
      clearInterval(poll);
      clearInterval(timerRef.current);
      stopBgMusic();
      supabase.removeAllChannels();
    };
  }, [isReady, roomId]);

  useEffect(() => {
    if (!boardRef.current || !particleRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    particleRef.current.width  = rect.width;
    particleRef.current.height = rect.height;
  }, [cellSize]);

  async function joinRoom() {
    // Check if player already exists (reconnect scenario)
    const { data: existing } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .eq('player_id', playerId.current)
      .maybeSingle();

    if (existing) {
      // Reconnect: restore state from DB, don't reset
      setMyBoard(existing.board || emptyBoard());
      setMyPieces(existing.pieces || make3Pieces(null));
      setMyScore(existing.score || 0);
      setMyGameOver(existing.is_game_over || false);
      gameOverRef.current = existing.is_game_over || false;
      // Update username in case it changed
      await supabase.from('players')
        .update({ username: username.current, updated_at: new Date().toISOString() })
        .eq('room_id', roomId).eq('player_id', playerId.current);
    } else {
      // New player: insert fresh
      const pieces = make3Pieces(null);
      setMyPieces(pieces);
      // Base columns (always exist)
      const baseRow = {
        room_id: roomId, player_id: playerId.current,
        username: username.current, board: emptyBoard(),
        pieces, score: 0, is_game_over: false,
      };
      const { error } = await supabase.from('players').insert(baseRow);
      if (error) {
        // Fallback upsert (race condition / duplicate)
        await supabase.from('players').upsert(baseRow, { onConflict: 'room_id,player_id' });
      }
    }

    const { data: room } = await supabase.from('rooms').select('*').eq('id', roomId).single();
    if (room) {
      setRoomStatus(room.status);
      setRoomData(room);
      if (room.game_start_at) setGameStartAt(room.game_start_at);
    }
    await fetchPlayers();
  }

  async function fetchPlayers() {
    const { data } = await supabase.from('players').select('*').eq('room_id', roomId).order('joined_at');
    if (!data) return;
    setPlayers(data);
    const opp = data.find(p => p.player_id !== playerId.current);
    if (opp) {
      setOpponent(opp);
      setOppWantRematch(opp.ready_for_rematch || false);
    }
    if (data.length >= 2) {
      const { data: room } = await supabase.from('rooms').select('*').eq('id', roomId).single();
      if (room?.status === 'waiting') {
        // Only host starts the game — but both players set their local status
        if (room.host_id === playerId.current) {
          const startAt = new Date().toISOString();
          await supabase.from('rooms').update({ status: 'playing', game_start_at: startAt }).eq('id', roomId);
          setGameStartAt(startAt);
          setRoomStatus('playing');
        } else {
          // Non-host: wait for room subscription to broadcast 'playing'
          // but also poll once more to avoid stuck waiting state
          setTimeout(async () => {
            const { data: r2 } = await supabase.from('rooms').select('*').eq('id', roomId).single();
            if (r2?.status === 'playing') {
              setRoomStatus('playing');
              setRoomData(r2);
              if (r2.game_start_at) setGameStartAt(r2.game_start_at);
            }
          }, 1500);
        }
      } else if (room) {
        setRoomStatus(room.status);
        setRoomData(room);
        if (room.game_start_at) setGameStartAt(room.game_start_at);
      }
    }
  }

  function subscribeToRoom() {
    supabase.channel(`room-${roomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        payload => {
          const r = payload.new;
          setRoomStatus(r.status);
          setRoomData(r);
          if (r.game_start_at) setGameStartAt(r.game_start_at);
        })
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
          setOppWantRematch(changed.ready_for_rematch || false);
        })
      .subscribe();
  }

  // ── Broadcast channel for realtime drag sync ──────────────────────────────
  function subscribeToDragBroadcast() {
    const ch = supabase.channel(`drag-${roomId}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'drag' }, ({ payload }) => {
      if (!payload || payload.pid === playerId.current) return;
      setOppDrag(payload.drag); // null = drag ended, or { piece, snap }
    }).subscribe();
    broadcastChannel.current = ch;
  }

  function broadcastDrag(dragPayload) {
    // throttle to ~30fps
    if (dragBroadcastThrottle.current) return;
    dragBroadcastThrottle.current = setTimeout(() => {
      dragBroadcastThrottle.current = null;
    }, 33);
    broadcastChannel.current?.send({
      type: 'broadcast', event: 'drag',
      payload: { pid: playerId.current, drag: dragPayload },
    });
  }

  // ── Supabase sync ─────────────────────────────────────────────────────────
  const syncDebounce = useRef(null);
  function syncState(board, pieces, score, isGameOver, survivalTime = null) {
    clearTimeout(syncDebounce.current);
    syncDebounce.current = setTimeout(async () => {
      const update = {
        board, pieces, score, is_game_over: isGameOver, updated_at: new Date().toISOString(),
      };
      // Try with new columns, fall back to base columns if schema is old
      const tryUpdate = async (data) => {
        const { error } = await supabase.from('players').update(data)
          .eq('room_id', roomId).eq('player_id', playerId.current);
        return error;
      };
      if (survivalTime !== null) update.survival_time = survivalTime;
      const err = await tryUpdate(update);
      if (err) {
        // Schema might be old — retry without new columns
        const { survival_time: _s, ready_for_rematch: _r, ...safeUpdate } = update;
        await tryUpdate(safeUpdate);
      }
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
    const piece = piecesStateRef.current[idx];
    setDrag({ idx, x: cx, y: cy });
    setSnap(null);
    broadcastDrag({ piece, snap: null });
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
    const snapData = { r: cell.r, c: cell.c, valid: canPlace(boardStateRef.current, piece.shape, cell.r, cell.c) };
    setSnap(snapData);
    broadcastDrag({ piece, snap: snapData });
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
    broadcastDrag(null);

    if (!ok) { sfxNoPlace(); return; }
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

    // FIX: pass current board to make3Pieces so pieces always fit
    const np = [...pieces]; np[savedIdx] = null;
    const allUsed = np.every(p => !p);

    if (lines > 0) {
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
        setShaking(true);
        setTimeout(() => setShaking(false), 400);
        if (lines >= 3) { setFlashing(true); setTimeout(() => setFlashing(false), 180); }
      }

      setClearing({ rows, cols });
      spawnParticles(particleRef.current, clearCells, cellSize, GAP, PAD, piece.color.light || '#fff');

      setTimeout(() => {
        const cb = clearLines(nb, rows, cols);
        // FIX: generate new pieces based on cleared board state
        const fp = allUsed ? make3Pieces(cb) : np;
        setMyBoard(cb); setClearing({ rows: [], cols: [] });
        setMyPieces(fp); setMyScore(ns);
        // FIX: check game over AFTER updating pieces with new board context
        const over = !anyPieceFits(cb, fp);
        if (over) handleGameOver(ns, cb, fp);
        else syncState(cb, fp, ns, false);
      }, 310);
    } else {
      setMyBoard(nb);
      // FIX: generate new pieces based on updated board
      const fp = allUsed ? make3Pieces(nb) : np;
      setMyPieces(fp); setMyScore(ns);
      // FIX: check game over against actual next pieces
      const over = !anyPieceFits(nb, fp);
      if (over) handleGameOver(ns, nb, fp);
      else syncState(nb, fp, ns, false);
    }
  }, [drag, cellSize, GAP, PAD]);

  async function handleGameOver(finalScore, board, pieces, timeUp = false) {
    if (gameOverRef.current) return; // prevent double trigger
    gameOverRef.current = true;
    setMyGameOver(true);
    sfxGameOver();

    const elapsed = gameStartAt
      ? Math.floor((Date.now() - new Date(gameStartAt).getTime()) / 1000)
      : 0;
    const survivalTime = Math.min(elapsed, GAME_DURATION);

    syncState(board, pieces, finalScore, true, survivalTime);

    await supabase.from('leaderboard').insert({
      username: username.current, score: finalScore, room_id: roomId,
      ...(survivalTime !== null ? { survival_time: survivalTime } : {}),
    }).then(({ error }) => {
      if (error) {
        // Fallback without survival_time
        supabase.from('leaderboard').insert({ username: username.current, score: finalScore, room_id: roomId });
      }
    });

    // Check if all players done
    setTimeout(async () => {
      const { data } = await supabase.from('players').select('is_game_over').eq('room_id', roomId);
      if (data && data.every(p => p.is_game_over))
        await supabase.from('rooms').update({ status: 'finished' }).eq('id', roomId);
    }, 800);
  }

  // ── Rematch ───────────────────────────────────────────────────────────────
  async function requestRematch() {
    setWantRematch(true);
    // Try to set ready_for_rematch (new column, may not exist in old schema)
    await supabase.from('players').update({ ready_for_rematch: true })
      .eq('room_id', roomId).eq('player_id', playerId.current).then(({ error }) => {
        if (error) console.warn('ready_for_rematch column missing, run migration SQL');
      });

    // If both want rematch, reset the game
    if (oppWantRematch) {
      await startRematch();
    }
  }

  async function startRematch() {
    const newBoard = emptyBoard();
    const newPieces = make3Pieces(null);
    const startAt = new Date().toISOString();

    // Reset both players
    await supabase.from('players').update({
      board: newBoard, pieces: newPieces, score: 0,
      is_game_over: false, updated_at: new Date().toISOString(),
    }).eq('room_id', roomId).eq('player_id', playerId.current);

    // Reset room
    const { data: room } = await supabase.from('rooms').select('round').eq('id', roomId).single();
    await supabase.from('rooms').update({
      status: 'playing',
      game_start_at: startAt,
      round: (room?.round || 1) + 1,
    }).eq('id', roomId).then(({ error }) => {
      if (error) {
        // Old schema without game_start_at/round — update just status
        supabase.from('rooms').update({ status: 'playing' }).eq('id', roomId);
      }
    });

    // Reset local state
    setMyBoard(newBoard);
    setMyPieces(newPieces);
    setMyScore(0);
    setMyGameOver(false);
    gameOverRef.current = false;
    setWantRematch(false);
    setOppWantRematch(false);
    setRoomStatus('playing');
    setGameStartAt(startAt);
    setTimeLeft(GAME_DURATION);
  }

  // Watch for both wanting rematch
  useEffect(() => {
    if (wantRematch && oppWantRematch && roomStatus === 'finished') {
      // Only host starts the rematch to avoid race condition
      supabase.from('rooms').select('host_id').eq('id', roomId).single().then(({ data }) => {
        if (data?.host_id === playerId.current) startRematch();
      });
    }
  }, [wantRematch, oppWantRematch]);

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

  // ── Winner logic: pemenang = siapa yang PALING LAMA bertahan ─────────────
  const winnerRef = useRef(null);
  const winner = useMemo(() => {
    if (roomStatus !== 'finished') return null;
    // If game ends by time (both hit 0), compare scores
    // Otherwise, whoever is still alive wins (longer survival time)
    const myTime = myGameOver
      ? (gameStartAt ? Math.floor((Date.now() - new Date(gameStartAt).getTime()) / 1000) : 0)
      : GAME_DURATION;
    const oppTime = opponent?.is_game_over
      ? (opponent.survival_time || 0)
      : GAME_DURATION;

    if (myTime > oppTime) return 'you';
    if (oppTime > myTime) return 'opponent';
    // Tiebreak by score
    if (myScore > (opponent?.score || 0)) return 'you';
    if ((opponent?.score || 0) > myScore) return 'opponent';
    return 'draw';
  }, [roomStatus, myGameOver, opponent, myScore, gameStartAt]);

  useEffect(() => {
    if (winner && !winnerRef.current) {
      winnerRef.current = winner;
      if (winner === 'you') sfxWin();
    }
  }, [winner]);

  // Reset winnerRef on rematch
  useEffect(() => {
    if (roomStatus === 'playing') winnerRef.current = null;
  }, [roomStatus]);

  // ── Ghost & display board ─────────────────────────────────────────────────
  const ghostCells = useMemo(() => {
    const s = new Set();
    if (!snap || drag === null || !myPieces[drag.idx]) return s;
    myPieces[drag.idx].shape.forEach((row, dr) =>
      row.forEach((v, dc) => { if (v) s.add(`${snap.r+dr},${snap.c+dc}`); }));
    return s;
  }, [snap, drag, myPieces]);

  // Ghost cells for opponent's dragging piece on their board
  const oppDragGhostCells = useMemo(() => {
    const s = new Set();
    if (!oppDrag?.piece || !oppDrag?.snap) return s;
    oppDrag.piece.shape.forEach((row, dr) =>
      row.forEach((v, dc) => { if (v) s.add(`${oppDrag.snap.r+dr},${oppDrag.snap.c+dc}`); }));
    return s;
  }, [oppDrag]);

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
    if (!next) musicStarted.current = false;
  }

  const floatPiece = drag !== null && myPieces[drag.idx];

  // Timer color
  const timerColor = timeLeft <= 30 ? '#e84040' : timeLeft <= 60 ? '#f5a623' : '#29c76a';
  const timerPulse = timeLeft <= 10;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Head><title>Block Blast Mabar — {roomId}</title></Head>

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

          {/* Timer — only show when playing */}
          {roomStatus === 'playing' && (
            <div className={`${styles.timer} ${timerPulse ? styles.timerPulse : ''}`}
              style={{ color: timerColor, borderColor: timerColor + '44' }}>
              ⏱ {formatTime(timeLeft)}
            </div>
          )}

          {/* Scoreboard toggle */}
          {roomStatus === 'playing' && opponent && (
            <button className={styles.scoreboardBtn} onClick={() => setShowScoreboard(s => !s)}>
              📊
            </button>
          )}

          <button className={styles.muteBtn} onClick={toggleMute} title={mutedUI ? 'Unmute' : 'Mute'}>
            {mutedUI ? '🔇' : '🔊'}
          </button>
        </div>

        {/* Inline scoreboard strip */}
        {showScoreboard && roomStatus === 'playing' && opponent && (
          <div className={styles.scoreStrip}>
            <div className={styles.scoreStripRow}>
              <span className={styles.ssName}>{username.current}</span>
              <div className={styles.ssBarWrap}>
                <div className={styles.ssBar} style={{
                  width: `${Math.min(100, (myScore / Math.max(myScore, opponent.score || 1, 1)) * 100)}%`,
                  background: '#f5a623',
                }} />
              </div>
              <span className={styles.ssScore}>{myScore.toLocaleString()}</span>
            </div>
            <div className={styles.scoreStripRow}>
              <span className={styles.ssName}>{opponent.username}</span>
              <div className={styles.ssBarWrap}>
                <div className={styles.ssBar} style={{
                  width: `${Math.min(100, ((opponent.score || 0) / Math.max(myScore, opponent.score || 1, 1)) * 100)}%`,
                  background: '#2e7de8',
                }} />
              </div>
              <span className={styles.ssScore}>{(opponent.score || 0).toLocaleString()}</span>
            </div>
            <div className={styles.ssNote}>⚡ Yang bertahan lebih lama = menang!</div>
          </div>
        )}

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
              <canvas ref={particleRef} className={styles.particleCanvas} style={{ pointerEvents: 'none' }} />
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
                  <div key={p.id}
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

          {/* VS + Timer center */}
          <div className={styles.vsDivider}>
            <div className={styles.vs}>VS</div>
            {roomStatus === 'playing' && (
              <div className={`${styles.vsTimer} ${timerPulse ? styles.timerPulse : ''}`}
                style={{ color: timerColor }}>
                {formatTime(timeLeft)}
              </div>
            )}
          </div>

          {/* OPPONENT BOARD */}
          <div className={styles.playerSection}>
            {opponent ? (
              <>
                <div className={styles.playerHeader}>
                  <span className={styles.playerName}>{opponent.username}</span>
                  <span className={styles.scoreVal}>{(opponent.score || 0).toLocaleString()}</span>
                </div>
                <div className={styles.boardWrap} ref={oppBoardRef} style={{ pointerEvents: 'none' }}>
                  <Board
                    board={opponent.board || emptyBoard()}
                    cellSize={oppCellSize}
                    ghostCells={oppDragGhostCells}
                    ghostValid={true}
                  />
                  {/* Opponent drag floating piece */}
                  {oppDrag?.piece && oppDrag?.snap && (
                    <div
                      className={styles.oppFloater}
                      style={{
                        left: oppDrag.snap.c * (oppCellSize + Math.max(2, Math.round(oppCellSize * 0.065))) + Math.round(oppCellSize * 0.2),
                        top:  oppDrag.snap.r * (oppCellSize + Math.max(2, Math.round(oppCellSize * 0.065))) + Math.round(oppCellSize * 0.2) - oppCellSize,
                      }}
                    >
                      <PieceCanvas shape={oppDrag.piece.shape} color={oppDrag.piece.color} maxSize={oppCellSize * 2.5} />
                    </div>
                  )}
                  {/* Dragging indicator badge */}
                  {oppDrag?.piece && (
                    <div className={styles.oppDragBadge}>
                      ✋ {opponent.username} sedang drag...
                    </div>
                  )}
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

        {/* ── Winner overlay (no redirect, stays in room) ── */}
        {winner && (
          <div className={styles.winnerOverlay}>
            <div className={styles.winnerCard}>
              {winner === 'you'      && <><div className={styles.winnerEmoji}>🏆</div><div className={styles.winnerTitle}>KAMU MENANG!</div></>}
              {winner === 'opponent' && <><div className={styles.winnerEmoji}>😢</div><div className={styles.winnerTitle}>KAMU KALAH</div></>}
              {winner === 'draw'     && <><div className={styles.winnerEmoji}>🤝</div><div className={styles.winnerTitle}>SERI!</div></>}
              {winner === 'you' && <div className={styles.confetti}>{Array.from({length:16}).map((_,i)=><span key={i} style={{'--i':i}}/>)}</div>}

              {/* Final scoreboard */}
              <div className={styles.finalBoard}>
                <div className={styles.fbTitle}>📊 Hasil Akhir</div>
                <div className={styles.fbRow + ' ' + (winner === 'you' ? styles.fbWinner : '')}>
                  <span className={styles.fbName}>👤 {username.current}</span>
                  <span className={styles.fbTime}>⏱ {formatTime(
                    myGameOver
                      ? Math.min(
                          gameStartAt ? Math.floor((Date.now() - new Date(gameStartAt).getTime()) / 1000) : 0,
                          GAME_DURATION
                        )
                      : GAME_DURATION
                  )}</span>
                  <span className={styles.fbScore}>{myScore.toLocaleString()}</span>
                </div>
                {opponent && (
                  <div className={styles.fbRow + ' ' + (winner === 'opponent' ? styles.fbWinner : '')}>
                    <span className={styles.fbName}>👤 {opponent.username}</span>
                    <span className={styles.fbTime}>⏱ {formatTime(opponent.survival_time || 0)}</span>
                    <span className={styles.fbScore}>{(opponent.score || 0).toLocaleString()}</span>
                  </div>
                )}
                <div className={styles.fbRule}>Pemenang = yang bertahan lebih lama ⚡</div>
              </div>

              {/* Rematch buttons */}
              <div className={styles.rematchRow}>
                {!wantRematch ? (
                  <button className={styles.rematchBtn} onClick={requestRematch}>
                    🔄 Main Lagi
                  </button>
                ) : (
                  <div className={styles.rematchWaiting}>
                    {oppWantRematch
                      ? '✅ Memulai ulang...'
                      : `⏳ Menunggu ${opponent?.username || 'lawan'}...`}
                  </div>
                )}
                <button className={styles.homeBtn} onClick={() => router.push('/')}>← Lobby</button>
              </div>
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