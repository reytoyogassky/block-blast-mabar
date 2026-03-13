# 🧱 Block Blast Mabar

Game Block Blast multiplayer real-time menggunakan **Next.js** + **Supabase**.

## Fitur
- 🎮 Multiplayer 1v1 real-time
- 🏆 Leaderboard global
- 🔗 Buat & gabung room dengan kode
- 📱 Support touch screen
- 🧱 Blok solid menyatu (tidak tembus antar kotak)

---

## Setup

### 1. Clone & Install

```bash
cd block-blast-mabar
npm install
```

### 2. Setup Supabase

1. Buka [supabase.com](https://supabase.com) → buat project baru
2. Masuk ke **SQL Editor**
3. Copy-paste isi file `supabase-setup.sql` → klik **Run**
4. Ambil URL & Anon Key dari **Settings → API**

### 3. Environment Variables

Duplikat file `.env.local.example` menjadi `.env.local`:

```bash
cp .env.local.example .env.local
```

Isi dengan credential Supabase kamu:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### 4. Jalankan

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000)

---

## Cara Main

1. Masukkan **username**
2. Klik **Buat Room Baru** → share kode 6 karakter ke teman
3. Teman masukkan kode → klik **Gabung**
4. Game otomatis mulai saat 2 pemain bergabung
5. **Drag blok** dari tray ke papan
6. Isi baris/kolom penuh → meledak dan dapat poin
7. Pemain dengan skor tertinggi saat game over menang!

---

## Struktur Project

```
block-blast-mabar/
├── lib/
│   ├── supabase.js        # Supabase client
│   └── gameLogic.js       # Logic game (murni fungsi)
├── components/
│   ├── Board.jsx          # Komponen papan game
│   ├── PieceCanvas.jsx    # Render piece ke canvas
│   └── Leaderboard.jsx    # Papan skor
├── pages/
│   ├── index.js           # Lobby (buat/gabung room)
│   └── room/[roomId].js   # Halaman game
├── styles/                # CSS Modules
├── supabase-setup.sql     # SQL untuk setup database
└── .env.local.example     # Template environment
```

## Database Schema

| Tabel | Deskripsi |
|-------|-----------|
| `rooms` | Info room (id, status, host) |
| `players` | State tiap pemain (board, pieces, score) |
| `leaderboard` | Skor terbaik semua pemain |

---

## Deploy ke Vercel

```bash
npx vercel
```

Set environment variables di Vercel dashboard:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
