// 配置工作台网页的 React 构建，保留 core 统一入口并排除仅供 Node 使用的实现。
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const WEB_ROOT = fileURLToPath(new URL('.', import.meta.url));
const OUTPUT_DIRECTORY = fileURLToPath(new URL('../../dist/web', import.meta.url));
// 若网页误用 core 的进程或文件能力，必须在构建时失败，不能交付依赖 Node 的浏览器脚本。
const BROWSER_BOUNDARY_PLUGIN: Plugin = {
  name: 'fae-browser-boundary',
  generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') continue;
      if ([...output.imports, ...output.dynamicImports].some(isBuiltin)) {
        this.error('Browser output must not depend on Node built-in modules.');
      }
    }
  },
};

export default defineConfig({
  root: WEB_ROOT,
  plugins: [react(), BROWSER_BOUNDARY_PLUGIN],
  build: {
    outDir: OUTPUT_DIRECTORY,
    emptyOutDir: true,
    rollupOptions: {
      // core 同时导出纯函数和 Node 能力；先保持原生外部引用，让未使用的能力正常摇树删除。
      external: (source) => isBuiltin(source),
      treeshake: {
        // 内置模块的空导入不承担浏览器初始化，不能让其阻止删除未使用的服务端分支。
        moduleSideEffects: (id, isExternal) => !(isExternal && isBuiltin(id)),
      },
    },
  },
});
