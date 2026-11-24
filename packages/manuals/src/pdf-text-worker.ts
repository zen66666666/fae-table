// 在独立线程内用 PDF.js 提取字号无关的纯文本，由手册文本索引启动。
import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDF_PAGE_CHAR_LIMIT, PDF_PAGE_LIMIT, PDF_TEXT_CHAR_LIMIT } from './text-limits.ts';
import type { ParsedManualText } from './text-types.ts';

const LOCAL_ASSETS = new URL('./', import.meta.resolve('pdfjs-dist/package.json'));
const RESOURCE_FILENAME = /^[\da-z_-]+\.(?:bcmap|pfb|ttf)$/iu;
const PDF_TEXT_OPTIONS = {
  useWorkerFetch: false,
  useWasm: false,
  disableAutoFetch: true,
  disableFontFace: true,
  disableRange: true,
  disableStream: true,
  disableWorkerRendering: true,
  enableXfa: false,
  isEvalSupported: false,
  isImageDecoderSupported: false,
  isOffscreenCanvasSupported: false,
  useSystemFonts: false,
  verbosity: 0,
};

class LocalPdfAssets {
  async fetch(options: { kind: string; filename: string }): Promise<Uint8Array> {
    // PDF 可以影响请求的资源名。仅开放随包交付的字体和 CMap，拒绝 URL、目录分隔符和其他扩展名。
    const { kind, filename } = options;
    const directory =
      kind === 'cMapUrl' && filename.endsWith('.bcmap')
        ? 'cmaps'
        : kind === 'standardFontDataUrl' && !filename.endsWith('.bcmap')
          ? 'standard_fonts'
          : undefined;
    if (!directory || !RESOURCE_FILENAME.test(filename)) throw new Error('pdf-asset-denied');
    return readFile(new URL(`${directory}/${filename}`, LOCAL_ASSETS));
  }
}

async function readPage(options: { page: PDFPageProxy; maxChars: number }): Promise<{
  text: string;
  isTruncated: boolean;
}> {
  const reader = options.page.streamTextContent().getReader();
  let text = '';
  try {
    while (text.length < options.maxChars) {
      const next = await reader.read();
      if (next.done) return { text: text.trim(), isTruncated: false };
      for (const item of (next.value as { items: unknown[] }).items) {
        if (!item || typeof item !== 'object' || !('str' in item) || typeof item.str !== 'string')
          continue;
        const part = `${item.str.slice(0, options.maxChars - text.length)}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`;
        text += part.slice(0, options.maxChars - text.length);
        if (text.length >= options.maxChars) break;
      }
    }
    return { text: text.trim(), isTruncated: true };
  } finally {
    await reader.cancel().catch(() => undefined);
    options.page.cleanup();
  }
}

async function extractText(bytes: Uint8Array): Promise<ParsedManualText> {
  // 1. 以字节加载并只开放本机资源。2. 按页逐段读取。3. 释放 PDF.js 资源。
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    // 1. 禁止以 URL 读取 PDF，PDF.js 的主线程资源加载也只能经固定本地工厂。
    ...PDF_TEXT_OPTIONS,
    data: bytes,
    cMapUrl: new URL('cmaps/', LOCAL_ASSETS).href,
    standardFontDataUrl: new URL('standard_fonts/', LOCAL_ASSETS).href,
    BinaryDataFactory: LocalPdfAssets,
  });
  try {
    const document = await task.promise;
    const pages: NonNullable<ParsedManualText['pages']> = [];
    let chars = 0;
    let isTruncated = document.numPages > PDF_PAGE_LIMIT;
    for (let page = 1; page <= Math.min(PDF_PAGE_LIMIT, document.numPages); page++) {
      // 2. 使用流获得字符片段，单页文字过多时终止继续消费。
      const maxChars = Math.min(PDF_PAGE_CHAR_LIMIT, PDF_TEXT_CHAR_LIMIT - chars);
      if (maxChars === 0) {
        isTruncated = true;
        break;
      }
      const result = await readPage({ page: await document.getPage(page), maxChars });
      isTruncated ||= result.isTruncated;
      if (result.text) pages.push({ page, text: result.text });
      chars += result.text.length;
    }
    return {
      kind: pages.length > 0 ? 'ready' : 'no-text',
      pageCount: document.numPages,
      charCount: chars,
      pages,
      isTruncated,
    };
  } finally {
    await task.destroy(); // 3.
  }
}

if (parentPort) {
  // 解析器只接收父进程提供的 PDF 字节，第三方代码也不能使用全局 fetch 发起请求。
  Object.defineProperty(globalThis, 'fetch', {
    value: () => Promise.reject(new Error('pdf-network-denied')),
    writable: false,
    configurable: false,
  });
  const result = await extractText(workerData as Uint8Array).catch(
    (): ParsedManualText => ({
      kind: 'invalid',
    }),
  );
  parentPort.postMessage(result);
}
