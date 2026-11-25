// 封装固定同源 HTTP 请求，供连接准备、单据与资料区共用。
import {
  AI_ACTIVE_ROUTE,
  AI_CHAT_CLEAR_SEGMENT,
  AI_CHAT_SEGMENT,
  AI_CHAT_STOP_SEGMENT,
  AI_ROUTES,
  CATALOG_FOLDER_PICK_ROUTE,
  CODETABLE_ROUTES,
  MANUALS_ROUTES,
  TICKET_DRAFT_SEGMENT,
  TICKET_IMAGES_SEGMENT,
  TICKET_MANUAL_REDOWNLOAD_SEGMENT,
  TICKET_MANUAL_MODEL_PARAMETER,
  TICKET_MANUAL_VIEW_SEGMENT,
  TICKET_MANUALS_SEGMENT,
  TICKET_PEOPLE_SEGMENT,
  TICKET_UPDATE_SEGMENT,
  TICKET_WRITE_ROUTES,
  WORKBENCH_STATUS_ROUTES,
} from '../../../packages/core/src/index.ts';
import type {
  AiChatActiveStatus,
  AiChatEvent,
  AiChatHistory,
  AiChatStopResult,
  AiConfigInput,
  AiModelRefreshResult,
  AiModelsInput,
  AiModelsResult,
  AiStatus,
  AiTestResult,
  CatalogFolderPickResult,
  CodeTableStatus,
  ConnectionReason,
  LoginResult,
  TicketDetailSnapshot,
  TicketDraft,
  TicketListSnapshot,
  TicketManualsResult,
  TicketManualResult,
  TicketPeopleResult,
  TicketReason,
  TicketWriteAction,
  TicketWriteAvailability,
  TicketWriteOutcome,
  TicketWritePreparation,
  WorkbenchStatus,
} from '../../../packages/core/src/index.ts';
import { readAiChatStream } from './ai-chat-stream.ts';
import { REASON_DETAILS } from './copy.ts';
import { TICKET_REASON_DETAILS } from './ticket-copy.ts';

const API_PATHS = {
  login: '/api/dingtalk/login',
  profile: '/api/dingtalk/profile',
  folder: '/api/catalog/folder',
  shutdown: '/api/shutdown',
  tickets: '/api/tickets',
  ticketRefresh: '/api/tickets/refresh',
} as const;
const REQUEST_TIMEOUT_MS = 60_000;
const LOGIN_TIMEOUT_MS = 330_000;
// 列表只取内存快照；未预读详情仍需给并行 CLI 读取留出有界等待时间。
const DETAIL_TIMEOUT_MS = 120_000;
// 对不明确的写入，要为上次结果复核和本次回读保留等待时间。
const TICKET_WRITE_TIMEOUT_MS = 150_000;
const AI_CHAT_CONTENT_TYPE = 'text/event-stream';
const TICKET_IMAGE_CONTENT_TYPE = 'image/';
const TICKET_IMAGE_ACCEPT = 'image/*';
const REQUEST_HEADER = { 'Content-Type': 'application/json', 'X-FAE-Request': '1' };
type RequestOptions = {
  body?: object;
  timeout?: number | null;
  method?: 'GET' | 'PUT';
  hasMarker?: boolean;
  signal?: AbortSignal;
  accept?: string;
  redirect?: RequestRedirect;
};

function getTicketPath(id: string): string {
  return `${API_PATHS.tickets}/${encodeURIComponent(id)}`;
}

function getDraftPath(id: string): string {
  return `${getTicketPath(id)}/${TICKET_DRAFT_SEGMENT}`;
}

function getManualsPath(id: string): string {
  return `${getTicketPath(id)}/${TICKET_MANUALS_SEGMENT}`;
}

function getManualFilePath(options: { id: string; model?: string; action: string }): string {
  const path = `${getManualsPath(options.id)}/${options.action}`;
  if (options.model === undefined) return path;
  const query = new URLSearchParams({ [TICKET_MANUAL_MODEL_PARAMETER]: options.model });
  return `${path}?${query}`;
}

function getAiChatPath(id: string): string {
  return `${getTicketPath(id)}/${AI_CHAT_SEGMENT}`;
}

function getTicketWritePath(id: string): string {
  return `${getTicketPath(id)}/${TICKET_WRITE_ROUTES.resource}`;
}

/**
 * 生成新标签页使用的同源 PDF 路径，授权与下载均由本机后台处理。
 * @param id 当前所选单据标识。
 * @param model 可选的当前单据内型号。
 * @returns 同源手册查看路径。
 * @throws 无预期错误；服务端校验单据范围。
 */
export function getTicketManualViewPath(id: string, model?: string): string {
  return getManualFilePath({ id, model, action: TICKET_MANUAL_VIEW_SEGMENT });
}

/** 仅保存允许展示的错误类别，不向组件传递原始网络错误或响应文本。 */
export class RequestError extends Error {
  readonly reason: TicketReason;

  /**
   * 创建可安全显示的请求错误。
   * @param reason 后台返回的原因类别。
   * @throws 无；未知原因归为 unknown。
   */
  constructor(reason: TicketReason) {
    super('Workbench request failed');
    this.reason = Object.hasOwn(TICKET_REASON_DETAILS, reason) ? reason : 'unknown';
  }
}

/** 发送单据问题和消费同源事件流所需的外部取消信号及事件回调。 */
export type TicketAiChatStreamOptions = {
  id: string;
  question: string;
  signal: AbortSignal;
  onEvent: (event: AiChatEvent) => void;
};

/** 同源工作台接口；各方法失败时抛出仅含原因类别的 RequestError。 */
export type WorkbenchClient = {
  getStatus: () => Promise<WorkbenchStatus>;
  refreshStatus: () => Promise<WorkbenchStatus>;
  fetchAiModels: (input: AiModelsInput) => Promise<AiModelsResult>;
  switchAiModel: (model: string) => Promise<AiStatus>;
  refreshAiModels: () => Promise<AiModelRefreshResult>;
  saveAiConfig: (config: AiConfigInput) => Promise<AiStatus>;
  testAi: (config?: AiConfigInput) => Promise<AiTestResult>;
  clearAiConfig: () => Promise<AiStatus>;
  login: (profile?: string) => Promise<LoginResult>;
  selectProfile: (profile: string) => Promise<WorkbenchStatus>;
  setFolder: (folder: string) => Promise<WorkbenchStatus>;
  pickCatalogFolder: () => Promise<CatalogFolderPickResult>;
  shutdown: () => Promise<void>;
  getTickets: () => Promise<TicketListSnapshot>;
  refreshTickets: () => Promise<TicketListSnapshot>;
  getTicketDetail: (id: string) => Promise<TicketDetailSnapshot>;
  getTicketImage: (options: { id: string; imageId: string; signal?: AbortSignal }) => Promise<Blob>;
  refreshTicket: (id: string) => Promise<TicketDetailSnapshot>;
  getTicketDraft: (id: string) => Promise<TicketDraft>;
  saveTicketDraft: (options: { id: string; draft: TicketDraft }) => Promise<TicketDraft>;
  getCodeTableStatus: () => Promise<CodeTableStatus>;
  refreshCodeTable: () => Promise<CodeTableStatus>;
  getTicketPeople: (id: string) => Promise<TicketPeopleResult>;
  getTicketManuals: (id: string) => Promise<TicketManualsResult>;
  refreshTicketManuals: (id: string) => Promise<TicketManualsResult>;
  redownloadTicketManual: (id: string, model?: string) => Promise<TicketManualResult>;
  openManualsFolder: () => Promise<void>;
  getTicketAiChat: (id: string) => Promise<AiChatHistory>;
  getActiveAiChats: () => Promise<AiChatActiveStatus>;
  stopTicketAiChat: (options: { id: string; runId: string }) => Promise<AiChatStopResult>;
  clearTicketAiChat: (id: string) => Promise<AiChatHistory>;
  streamTicketAiChat: (options: TicketAiChatStreamOptions) => Promise<void>;
  getTicketWriteAvailability: (id: string) => Promise<TicketWriteAvailability>;
  prepareTicketWrite: (options: {
    id: string;
    action: TicketWriteAction;
    text: string;
  }) => Promise<TicketWritePreparation>;
  executeTicketWrite: (options: { id: string; code: string }) => Promise<TicketWriteOutcome>;
};

function toRequestError(error: unknown): RequestError {
  if (error instanceof RequestError) return error;
  return new RequestError(
    error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'unknown',
  );
}

/**
 * 将请求异常收窄为连接页允许展示的类别，避免把单据专用原因交给连接卡片。
 * @param error 请求异常。
 * @returns 已知连接原因，无法识别时返回 unknown。
 * @throws 无预期错误。
 */
export function getConnectionErrorReason(error: unknown): ConnectionReason {
  return error instanceof RequestError && Object.hasOwn(REASON_DETAILS, error.reason)
    ? (error.reason as ConnectionReason)
    : 'unknown';
}

/**
 * 创建可替换网络实现的工作台客户端。
 * @param fetcher 请求实现，默认使用浏览器 fetch。
 * @returns 仅暴露固定连接、单据读取和本机草稿接口的客户端。
 * @throws 创建时不抛错；请求失败由各方法报告。
 */
export function createWorkbenchClient(fetcher: typeof fetch = fetch): WorkbenchClient {
  async function fetchResponse(path: string, options: RequestOptions): Promise<Response> {
    const {
      body,
      timeout = REQUEST_TIMEOUT_MS,
      method,
      hasMarker,
      signal,
      accept,
      redirect,
    } = options;
    const headers = hasMarker || body !== undefined ? REQUEST_HEADER : undefined;
    const deadline = timeout === null ? undefined : AbortSignal.timeout(timeout);
    const requestSignal =
      signal && deadline ? AbortSignal.any([signal, deadline]) : (signal ?? deadline);
    const response = await fetcher(path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: accept ? { ...headers, Accept: accept } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestSignal,
      redirect,
    });
    if (!response.ok) throw new RequestError((await response.json())?.reason ?? 'unknown');
    return response;
  }
  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    try {
      const response = await fetchResponse(path, options);
      return (await response.json()) as T;
    } catch (error) {
      throw toRequestError(error);
    }
  }
  async function streamTicketAiChat(options: TicketAiChatStreamOptions): Promise<void> {
    const { id, question, signal, onEvent } = options;
    try {
      const response = await fetchResponse(getAiChatPath(id), {
        body: { question },
        signal,
        accept: AI_CHAT_CONTENT_TYPE,
        // 模型空闲期限由后台处理；浏览器只在调用方取消时断开可持续的回答流。
        timeout: null,
      });
      if (
        !response.body ||
        !response.headers.get('content-type')?.startsWith(AI_CHAT_CONTENT_TYPE)
      ) {
        throw new RequestError('protocol');
      }
      await readAiChatStream({ body: response.body, onEvent });
    } catch (error) {
      throw toRequestError(error);
    }
  }
  async function getTicketImage(options: {
    id: string;
    imageId: string;
    signal?: AbortSignal;
  }): Promise<Blob> {
    const { id, imageId, signal } = options;
    try {
      // 图片路由只接受本机生成的标识；拒绝跳转，避免把访问带到工作台以外。
      const url = `${getTicketPath(id)}/${TICKET_IMAGES_SEGMENT}/${encodeURIComponent(imageId)}`;
      const response = await fetchResponse(url, {
        hasMarker: true,
        signal,
        accept: TICKET_IMAGE_ACCEPT,
        redirect: 'error',
      });
      if (!response.headers.get('content-type')?.startsWith(TICKET_IMAGE_CONTENT_TYPE))
        throw new RequestError('protocol');
      return await response.blob();
    } catch (error) {
      throw toRequestError(error);
    }
  }
  return {
    getStatus: () => request(WORKBENCH_STATUS_ROUTES.status),
    refreshStatus: () => request(WORKBENCH_STATUS_ROUTES.refresh, { body: {} }),
    fetchAiModels: (input) => request(AI_ROUTES.models, { body: input }),
    switchAiModel: (model) => request(AI_ROUTES.switchModel, { body: { model } }),
    refreshAiModels: () => request(AI_ROUTES.refreshModels, { body: {} }),
    saveAiConfig: (config) => request(AI_ROUTES.config, { body: config }),
    testAi: (config) => request(AI_ROUTES.test, { body: config ?? {} }),
    clearAiConfig: () => request(AI_ROUTES.clear, { body: {} }),
    login: (profile) =>
      request(API_PATHS.login, { body: profile ? { profile } : {}, timeout: LOGIN_TIMEOUT_MS }),
    selectProfile: (profile) => request(API_PATHS.profile, { body: { profile } }),
    setFolder: (folder) => request(API_PATHS.folder, { body: { folder } }),
    pickCatalogFolder: () => request(CATALOG_FOLDER_PICK_ROUTE, { body: {} }),
    shutdown: async () => {
      await request(API_PATHS.shutdown, { body: {} });
    },
    getTickets: () => request(API_PATHS.tickets),
    refreshTickets: () => request(API_PATHS.ticketRefresh, { body: {} }),
    getTicketDetail: (id) => request(getTicketPath(id), { timeout: DETAIL_TIMEOUT_MS }),
    getTicketImage,
    refreshTicket: (id) =>
      request(`${getTicketPath(id)}/${TICKET_UPDATE_SEGMENT}`, {
        body: {},
        timeout: DETAIL_TIMEOUT_MS,
      }),
    getTicketDraft: (id) => request(getDraftPath(id), { hasMarker: true }),
    saveTicketDraft: ({ id, draft }) => request(getDraftPath(id), { method: 'PUT', body: draft }),
    getCodeTableStatus: () => request(CODETABLE_ROUTES.status),
    refreshCodeTable: () => request(CODETABLE_ROUTES.refresh, { body: {} }),
    getTicketPeople: (id) => request(`${getTicketPath(id)}/${TICKET_PEOPLE_SEGMENT}`),
    getTicketManuals: (id) => request(getManualsPath(id)),
    refreshTicketManuals: (id) => request(getManualsPath(id), { body: {} }),
    redownloadTicketManual: (id, model) =>
      request(getManualFilePath({ id, model, action: TICKET_MANUAL_REDOWNLOAD_SEGMENT }), {
        body: {},
      }),
    openManualsFolder: async () => {
      await request(MANUALS_ROUTES.openFolder, { body: {} });
    },
    getTicketAiChat: (id) => request(getAiChatPath(id), { hasMarker: true }),
    getActiveAiChats: () => request(AI_ACTIVE_ROUTE, { hasMarker: true }),
    stopTicketAiChat: ({ id, runId }) =>
      request(`${getAiChatPath(id)}/${AI_CHAT_STOP_SEGMENT}`, { body: { runId } }),
    clearTicketAiChat: (id) =>
      request(`${getAiChatPath(id)}/${AI_CHAT_CLEAR_SEGMENT}`, { body: {} }),
    streamTicketAiChat,
    getTicketWriteAvailability: (id) => request(getTicketWritePath(id), { hasMarker: true }),
    prepareTicketWrite: ({ id, action, text }) =>
      request(`${getTicketWritePath(id)}/${TICKET_WRITE_ROUTES.prepare}`, {
        body: { action, text },
      }),
    executeTicketWrite: ({ id, code }) =>
      request(`${getTicketWritePath(id)}/${TICKET_WRITE_ROUTES.execute}`, {
        body: { code },
        timeout: TICKET_WRITE_TIMEOUT_MS,
      }),
  };
}
