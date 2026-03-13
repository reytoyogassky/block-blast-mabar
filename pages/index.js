import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import Leaderboard from '../components/Leaderboard';
import styles from '../styles/Home.module.css';

function genId(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

function getPlayerId() {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('bb_player_id');
  if (!id) { id = genId(10); localStorage.setItem('bb_player_id', id); }
  return id;
}

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [openRooms, setOpenRooms] = useState([]);

  useEffect(() => {
    const saved = localStorage.getItem('bb_username');
    if (saved) setUsername(saved);
    fetchOpenRooms();

    const channel = supabase
      .channel('rooms-lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchOpenRooms)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function fetchOpenRooms() {
    const { data } = await supabase
      .from('rooms')
      .select('id, status, created_at')
      .eq('status', 'waiting')
      .order('created_at', { ascending: false })
      .limit(6);
    if (data) setOpenRooms(data);
  }

  function saveName(name) {
    setUsername(name);
    localStorage.setItem('bb_username', name);
  }

  async function createRoom() {
    if (!username.trim()) { setError('Masukkan username dulu!'); return; }
    setLoading('create'); setError('');
    const roomId = genId(6);
    const playerId = getPlayerId();

    const { error: rErr } = await supabase.from('rooms').insert({
      id: roomId, host_id: playerId, status: 'waiting',
    });
    if (rErr) { setError('Gagal membuat room. Coba lagi.'); setLoading(''); return; }

    localStorage.setItem('bb_username', username);
    router.push(`/room/${roomId}?name=${encodeURIComponent(username)}`);
  }

  async function joinRoom(code) {
    const id = (code || roomCode).trim().toUpperCase();
    if (!username.trim()) { setError('Masukkan username dulu!'); return; }
    if (!id) { setError('Masukkan kode room!'); return; }
    setLoading('join'); setError('');

    const { data, error: rErr } = await supabase
      .from('rooms').select('id, status').eq('id', id).single();

    if (rErr || !data) { setError('Room tidak ditemukan!'); setLoading(''); return; }
    if (data.status === 'finished') { setError('Room sudah selesai.'); setLoading(''); return; }

    localStorage.setItem('bb_username', username);
    router.push(`/room/${id}?name=${encodeURIComponent(username)}`);
  }

  return (
    <div className={styles.page}>
      <div className={styles.left}>
        <div className={styles.logo}>
          <span className={styles.logoBlock}>BLOCK</span>
          <span className={styles.logoBang}>BLAST</span>
          <span className={styles.logoSub}>MABAR</span>
        </div>

        <div className={styles.card}>
          <label className={styles.label}>Username</label>
          <input
            className={styles.input}
            placeholder="Nama kamu..."
            value={username}
            onChange={e => saveName(e.target.value)}
            maxLength={16}
            onKeyDown={e => e.key === 'Enter' && createRoom()}
          />

          <div className={styles.divider}>— atau —</div>

          <label className={styles.label}>Kode Room</label>
          <div className={styles.joinRow}>
            <input
              className={styles.input}
              placeholder="ABC123"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
              maxLength={6}
              onKeyDown={e => e.key === 'Enter' && joinRoom()}
              style={{ letterSpacing: 4, textTransform: 'uppercase' }}
            />
            <button className={styles.btnSecondary} onClick={() => joinRoom()} disabled={!!loading}>
              {loading === 'join' ? '...' : 'Gabung'}
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.btnPrimary} onClick={createRoom} disabled={!!loading}>
            {loading === 'create' ? 'Membuat...' : '+ Buat Room Baru'}
          </button>
        </div>

        {openRooms.length > 0 && (
          <div className={styles.card}>
            <p className={styles.label}>Room Terbuka</p>
            <div className={styles.roomList}>
              {openRooms.map(r => (
                <button key={r.id} className={styles.roomItem} onClick={() => joinRoom(r.id)}>
                  <span className={styles.roomCode}>{r.id}</span>
                  <span className={styles.roomTag}>Menunggu</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={styles.right}>
        <Leaderboard />
      </div>
    </div>
  );
}
