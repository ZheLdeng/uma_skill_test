import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages 部署在 https://<user>.github.io/uma_skill_test/ 下，
// 构建时需要设置 base 为仓库名；本地 dev / preview 用根路径。
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/uma_skill_test/" : "/",
  plugins: [react()],
}));
