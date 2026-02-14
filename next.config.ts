import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',  // Для Electron нужен статический экспорт
  images: {
    unoptimized: true  // Отключаем оптимизацию изображений для статического экспорта
  },
  trailingSlash: true  // Добавляем слеши в конце URL
};

export default nextConfig;