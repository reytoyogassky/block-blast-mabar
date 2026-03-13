# 🧱 Block Blast Mabar v2

Game Block Blast multiplayer real-time menggunakan **Next.js** + **Supabase**.

## Fitur
- 🎮 Multiplayer 1v1 real-time
- ⏱ **Timer duel 3 menit** — yang bertahan lebih lama menang!
- 📊 **Scoreboard live** saat bermain (klik 📊)
- 🔄 **Rematch langsung** tanpa ganti room
- 🏆 Leaderboard global
- 🔗 Buat & gabung room dengan kode
- 📱 Support touch screen
- 🧱 Blok dijamin selalu bisa ditempatkan (no more instant game over!)

## Aturan Menang
> **Pemain yang bertahan lebih lama = MENANG** — bukan yang skornya lebih tinggi!
> Skor tetap dihitung sebagai tiebreaker kalau waktu sama.

---

## Setup

### 1. Clone & Install
```bash
npm install
```

### 2. Setup Supabase
1. Buka [supabase.com](https://supabase.com) → buat project baru
2. Masuk ke **SQL Editor**
3. Copy-paste isi file `supabase-setup.sql` → klik **Run**
4. Ambil URL & Anon Key dari **Settings → API**

### 3. Environment Variables
Isi `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### 4. Jalankan
```bash
npm run dev
```

---

## Cara Main
1. Masukkan **username**
2. Klik **Buat Room Baru** → share kode ke teman
3. Game mulai saat 2 pemain bergabung
4. **Drag blok** ke papan — susun baris/kolom penuh untuk meledak
5. Timer 3 menit berjalan — bertahan selama mungkin!
6. Setelah selesai, klik **Main Lagi** untuk rematch di room yang sama

## Perubahan v2
- ✅ Fix: blok baru selalu dijamin bisa ditempatkan
- ✅ Fix: game over tidak lagi muncul prematur
- ✅ Tambah: timer countdown 3 menit
- ✅ Tambah: scoreboard live (toggle 📊)
- ✅ Tambah: rematch tanpa ganti room
- ✅ Tambah: `survival_time` tracking untuk penentuan pemenang
