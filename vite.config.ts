import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// 러버블 플러그인 2개를 제거했다.
//   componentTagger()  개발 중 DOM 에 러버블용 식별자를 심는다.
//   mcpPlugin()        빌드 때 supabase/functions/mcp/index.ts 를 생성·덮어썼다.
//                      빌드가 소스를 고치는 구조라 npm install 만 해도
//                      커밋되지 않은 변경이 생겼다.
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: { overlay: false },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
