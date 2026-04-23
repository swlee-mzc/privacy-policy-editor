import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 하위 경로 대응: /<repo>/
// 배포 저장소명이 privacy-policy-editor 임을 전제로 설정.
export default defineConfig({
  base: '/privacy-policy-editor/',
  plugins: [react()],
});
