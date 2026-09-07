# Panduan Migrasi: Next.js → Vite + React

> Dokumen ini menjelaskan aturan penulisan kode selama fase development di Next.js,
> agar seluruh codebase dapat dimigrasikan ke Vite (single-file HTML) tanpa perombakan besar.

---

## Tujuan Akhir

Build output berupa **satu file `index.html`** yang dapat dibuka langsung di browser
tanpa web server apapun, menggunakan:

- **Vite** sebagai bundler
- **vite-plugin-singlefile** untuk inline semua asset ke dalam 1 HTML
- **React Router v7** sebagai pengganti Next.js routing
- **React Query** opsional jika nanti ada integrasi API nyata

---

## 1. Routing — Jangan Gunakan Fitur Eksklusif Next.js

### Hindari
```tsx
// next/navigation — TIDAK ADA di Vite
import { redirect } from "next/navigation";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { usePathname } from "next/navigation";
import Link from "next/link";
```

### Yang Harus Dilakukan Saat Ini
Seluruh penggunaan `next/navigation` dan `next/link` harus **dibungkus dalam komponen abstraksi**
agar mudah diganti satu tempat saat migrasi.

Contoh helper yang sudah dibuat:
- `useRouter()` — gunakan hanya untuk `router.push()` dan `router.replace()`
- `useSearchParams()` — hanya baca query param `?key=value`
- `<Link href="...">` — selalu gunakan komponen `Link` dari Next.js, bukan `<a>`

### Yang perlu diganti saat migrasi
| Next.js | Vite (React Router v7) |
|---------|------------------------|
| `import Link from "next/link"` | `import { Link } from "react-router-dom"` |
| `useRouter().push(url)` | `useNavigate()(url)` |
| `useRouter().replace(url)` | `useNavigate()(url, { replace: true })` |
| `useSearchParams().get("key")` | `useSearchParams()[0].get("key")` |
| `usePathname()` | `useLocation().pathname` |
| `redirect("/dashboard")` | `<Navigate to="/dashboard" />` |

---

## 2. Halaman (Pages) — Buat Sebagai Komponen Biasa

### Hindari pola Next.js spesifik
```tsx
// Metadata — TIDAK bisa di Vite
export const metadata: Metadata = {
  title: "...",
};

// generateStaticParams — TIDAK ada di Vite
export async function generateStaticParams() { ... }
```

### Yang Harus Dilakukan
Setiap `page.tsx` harus ditulis sebagai **React component biasa** yang bisa di-import langsung:

```tsx
// Pola yang benar — kompatibel dengan Vite
export default function DashboardPage() {
  return <AppShell>...</AppShell>;
}
```

Semua page yang ada sudah menggunakan pola ini.

---

## 3. `"use client"` — Selalu Tambahkan

Karena Next.js memiliki konsep Server Component dan Client Component,
semua komponen di proyek ini **harus selalu diberi `"use client"`** di baris pertama.

```tsx
"use client"; // selalu ada di baris pertama setiap file .tsx

import { useState } from "react";
...
```

Saat migrasi ke Vite, directive `"use client"` cukup **dihapus semua** — tidak berpengaruh apapun.

---

## 4. `<Suspense>` untuk `useSearchParams()` — Tetap Pertahankan

Semua page yang menggunakan `useSearchParams()` sudah dibungkus `<Suspense>`.
Pola ini **tetap valid di Vite** sehingga tidak perlu diubah saat migrasi.

```tsx
// Pola ini aman di Next.js maupun Vite
export default function MyPage() {
  return (
    <Suspense fallback={null}>
      <MyPageContent />
    </Suspense>
  );
}

function MyPageContent() {
  const params = useSearchParams(); // aman di dalam Suspense
  ...
}
```

---

## 5. Data & State — Gunakan Hanya Client-Side

### Hindari
```tsx
// Server-side fetch — TIDAK ada di Vite
export async function getServerSideProps() { ... }
export async function getStaticProps() { ... }
```

### Yang Harus Dilakukan
Semua data harus diakses **di dalam komponen** menggunakan:
- Mock data dari `src/lib/data/` — langsung import
- Service layer dari `src/lib/services.ts` — panggil di dalam komponen
- State management: `useState`, `useReducer`, atau Zustand (jika diperlukan)

Struktur yang sudah ada di proyek ini sudah benar:
```tsx
// Ini cara yang benar — kompatibel dengan Vite
const complexes = complexService.list();
const [state, setState] = useState(...);
```

---

## 6. API Routes — JANGAN Buat

Next.js mendukung `src/app/api/route.ts`. **Jangan gunakan fitur ini.**

Jika nanti butuh akses ke backend nyata:
- Panggil endpoint eksternal langsung dari client menggunakan `fetch()` atau `axios`
- Simpan logic di `src/lib/api/` sebagai fungsi biasa

```tsx
// Cara yang benar
// src/lib/api/greenhouse.ts
export async function fetchGreenhouses(complexId: string) {
  const res = await fetch(`https://api.myserver.com/complexes/${complexId}/greenhouses`);
  return res.json();
}
```

---

## 7. Image & Asset — Hindari `next/image`

### Hindari
```tsx
import Image from "next/image"; // TIDAK ada di Vite
```

### Yang Harus Dilakukan
Gunakan tag `<img>` biasa atau import SVG sebagai komponen:

```tsx
// Gambar biasa
<img src="/logo.png" alt="Logo" className="h-8" />

// SVG sebagai komponen (Vite mendukung ini)
import LogoIcon from "@/assets/logo.svg?react";
```

---

## 8. Font & CSS — Hindari `next/font`

### Hindari
```tsx
import { Inter } from "next/font/google"; // TIDAK ada di Vite
```

### Yang Harus Dilakukan
Gunakan Google Fonts via import di CSS:

```css
/* globals.css */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
```

---

## 9. Path Alias `@/` — Sudah Kompatibel

Alias `@/` yang digunakan di seluruh codebase (`@/components`, `@/lib`, dll)
sudah dikonfigurasi di `tsconfig.json` dan **bisa dipakai langsung di Vite**
dengan menambahkan config berikut:

```ts
// vite.config.ts (saat migrasi)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

---

## 10. Environment Variables

### Next.js (sekarang)
```
NEXT_PUBLIC_API_URL=https://api.example.com
```

### Vite (saat migrasi)
```
VITE_API_URL=https://api.example.com
```

### Rekomendasi: Bungkus dalam helper agar mudah diganti
```ts
// src/lib/config.ts
export const API_URL =
  (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_API_URL : undefined) ??
  import.meta.env.VITE_API_URL ??
  "";
```

---

## 11. Layout — Ganti `RootLayout` dengan `App.tsx`

### Next.js (sekarang): `src/app/layout.tsx`
```tsx
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
```

### Vite (saat migrasi): `src/App.tsx`
```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ToastProvider } from "@/components/ui/toast";
import DashboardPage from "@/app/dashboard/page";
import ComplexPage from "@/app/complex/page";
// ... import semua page

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/complex" element={<ComplexPage />} />
          <Route path="/greenhouse/:ghId" element={<GreenhousePage />} />
          <Route path="/fertigation" element={<FertigationPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/calibration" element={<CalibrationPage />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
```

---

## 12. Dynamic Route Params — Persiapkan Pola yang Tepat

### Next.js (sekarang): params via folder `[ghId]`
Karena proyek ini menggunakan query params (`?gh=gh-01`) bukan path params,
ini sudah kompatibel dengan pola yang mudah dimigrasikan.

### Vite (saat migrasi): jika butuh path params
```tsx
// react-router-dom
import { useParams } from "react-router-dom";
const { ghId } = useParams();
```

### Rekomendasi sekarang
Tetap gunakan **query param** (`?gh=gh-01`) karena `useSearchParams()` mudah diganti
di kedua framework dan logika penggantiannya seragam.

---

## Checklist Migrasi (Lakukan di Akhir)

- [ ] Install: `vite`, `@vitejs/plugin-react`, `vite-plugin-singlefile`, `react-router-dom`
- [ ] Buat `vite.config.ts` dengan alias `@/` dan plugin singlefile
- [ ] Buat `index.html` entry point
- [ ] Buat `src/main.tsx` sebagai entry React
- [ ] Buat `src/App.tsx` dengan React Router (lihat contoh di bagian 11)
- [ ] Ganti semua `import { ... } from "next/navigation"` dengan `react-router-dom`
- [ ] Ganti semua `import Link from "next/link"` dengan `import { Link } from "react-router-dom"`
- [ ] Hapus semua `"use client"` directive
- [ ] Hapus `export const metadata` dari semua file
- [ ] Ganti env vars `NEXT_PUBLIC_*` dengan `VITE_*`
- [ ] Jalankan `npm run build` — output di `dist/index.html` (single file)
- [ ] Test buka `dist/index.html` langsung di browser tanpa server

---

## Struktur File Saat Ini (Next.js) vs Nanti (Vite)

```
src/
├── app/
│   ├── layout.tsx              ← GANTI: jadi src/App.tsx + src/main.tsx
│   ├── page.tsx                ← GANTI: jadi <Navigate to="/dashboard" />
│   ├── dashboard/page.tsx      ← Routing tetap sama, impor ke App.tsx
│   ├── complex/page.tsx        ← Routing tetap sama
│   ├── greenhouse/[ghId]/      ← Routing tetap sama
│   ├── fertigation/page.tsx    ← Routing tetap sama
│   ├── schedule/page.tsx       ← Routing tetap sama
│   └── calibration/page.tsx   ← Routing tetap sama
├── components/
│   ├── layout/                 ← TIDAK perlu diubah
│   ├── schedule/               ← TIDAK perlu diubah
│   └── ui/                     ← TIDAK perlu diubah
└── lib/
    ├── data/                   ← TIDAK perlu diubah
    ├── services.ts             ← TIDAK perlu diubah
    ├── store.ts                ← TIDAK perlu diubah
    ├── types.ts                ← TIDAK perlu diubah
    └── format.ts               ← TIDAK perlu diubah
```

> **Kesimpulan:** Hanya `src/app/layout.tsx` dan `src/app/page.tsx` yang perlu di-refactor
> saat migrasi. Semua komponen, lib, types, dan data **tidak perlu diubah sama sekali**.
