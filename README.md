This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Рыночные данные (Electron + SQLite)

- Исходные минутные ряды лежат в репозитории как `.txt` (см. каталог `marketInstrumentCatalog.json` после `npm run gen:market-catalog`). Рантайм приложения читает **только SQLite** (`data/market.sqlite`), собираемую скриптом **`npm run build:market-db`** (в `data/` также копируется `tradingCalendar.json` для Electron main). Скрипт сборки БД использует **`better-sqlite3`** (devDependency); окно Electron читает тот же файл через **`sql.js`** (WASM), чтобы не зависеть от ABI нативного модуля под версию Node в Electron.
- Полный рынок и график: **`npm run electron:dev`** (Next + окно Electron с IPC к SQLite). Чистый `npm run dev` в браузере рыночные ряды не подгружает (до гидратации график пустой).
- Релиз: `npm run electron:build` (перед упаковкой автоматически вызывается `build:market-db`). В установщик через `extraResources` попадают `market.sqlite` и `tradingCalendar.json`; исходные `.txt` в релиз не включаются.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
