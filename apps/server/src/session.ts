// 管理一次性启动码与会话，供 HTTP 路由校验本机访问来源和身份。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { ConnectionReason, ProcessClock } from '../../../packages/core/src/index.ts';
import {
  BROWSER_OPEN_TIMEOUT_MS,
  COOKIE_NAME_PREFIX,
  LAUNCH_LIFETIME_MS,
  REQUEST_HEADER,
  ROUTES,
  SERVER_HOST,
} from './constants.ts';
import type { ServerDependencies } from './types.ts';

const SYSTEM_CLOCK: ProcessClock = { setTimeout, clearTimeout };

/** 会话存储依赖；随机数和时钟可替换，避免验证代码依赖真实时间。 */
export type SessionOptions = Pick<ServerDependencies, 'now' | 'createSecret'> & {
  getPort: () => number;
  clock?: ProcessClock;
};

/** 本次打开的观察句柄；地址只交给浏览器，到达结果只含布尔值，结束后必须取消观察。 */
export type LaunchObservation = {
  launchUrl: string;
  hasArrived: Promise<boolean>;
  cancel: () => void;
};

type LaunchObserver = { session?: string; finish: (hasArrived: boolean) => void };

/**
 * 比较两个固定长度的随机令牌，拒绝非字符串和长度不符的值。
 * @param actual 收到的令牌。
 * @param expected 当前实例持有的令牌。
 * @returns 是否完全相同。
 * @throws 不抛出预期错误。
 */
export function hasMatchingSecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

/**
 * 校验精确 Host 和可选 Origin，阻止其他网站、localhost 别名和 DNS 重绑定。
 * @param request 当前请求。
 * @param port 本服务随机监听的端口。
 * @returns 请求是否来自允许的本机地址。
 * @throws 不抛出预期错误。
 */
export function hasAllowedOrigin(request: IncomingMessage, port: number): boolean {
  const authority = `${SERVER_HOST}:${port}`;
  if (request.headers.host !== authority) return false;
  const origin = request.headers.origin;
  return origin === undefined || origin === `http://${authority}`;
}

/** 单个后台实例的启动码和会话容器；所有值只存在本进程内存。 */
export class SessionStore {
  private options: SessionOptions;
  private codes = new Map<string, number>();
  private sessions = new Set<string>();
  private launchObservers = new Map<string, LaunchObserver>();
  private sessionObservers = new Map<string, LaunchObserver>();

  /**
   * 构造会话容器。
   * @param options 随机码生成器和当前时间。
   * @throws 不抛出预期错误。
   */
  constructor(options: SessionOptions) {
    this.options = options;
  }

  /**
   * 产生一个限时且只能使用一次的启动地址。
   * @param port 当前实例监听端口。
   * @returns 本机启动 URL。
   * @throws 随机数生成失败时抛错。
   */
  createLaunchUrl(port: number): string {
    return this.formatLaunchUrl(port, this.createLaunchCode());
  }

  private createLaunchCode(): string {
    for (const [code, expiration] of this.codes) {
      if (expiration <= this.options.now()) this.codes.delete(code);
    }
    const code = this.options.createSecret();
    this.codes.set(code, this.options.now() + LAUNCH_LIFETIME_MS);
    return code;
  }

  private formatLaunchUrl(port: number, code: string): string {
    return `http://${SERVER_HOST}:${port}${ROUTES.launch}?code=${encodeURIComponent(code)}`;
  }

  /**
   * 创建新的单次启动地址，并仅观察该地址交换出的会话是否到达状态接口。
   * @param port 当前实例监听端口。
   * @returns 内存中的地址、到达结果和清理函数；超时或取消时到达结果为 false。
   * @throws 随机数或注入计时器异常时抛错，不向终端输出任何凭证。
   */
  observeLaunch(port: number): LaunchObservation {
    // 1. 创建本次启动码；2. 注册有界观察；3. 返回仅供控制流程持有的句柄。
    const code = this.createLaunchCode();
    const clock = this.options.clock ?? SYSTEM_CLOCK;
    let complete!: (hasArrived: boolean) => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hasArrived = new Promise<boolean>((resolve) => {
      complete = resolve;
    });
    // 2. 不直接拒绝 Promise，避免打开浏览器尚未返回时产生未处理的超时异常。
    const observer: LaunchObserver = {
      finish: (isArrived) => {
        if (!this.launchObservers.delete(code)) return;
        if (observer.session) this.sessionObservers.delete(observer.session);
        clock.clearTimeout(timer);
        complete(isArrived);
      },
    };
    this.launchObservers.set(code, observer);
    try {
      timer = clock.setTimeout(() => observer.finish(false), BROWSER_OPEN_TIMEOUT_MS);
    } catch (error) {
      observer.finish(false);
      throw error;
    }
    // 3. 每次打开独立观察，旧标签页的会话不能确认新的启动请求。
    return {
      launchUrl: this.formatLaunchUrl(port, code),
      hasArrived,
      cancel: () => observer.finish(false),
    };
  }

  /**
   * 消耗启动码并设置会话 cookie；校验和删除之间没有异步窗口。
   * @param code URL 中的启动码。
   * @param response 需要写入会话 cookie 的响应。
   * @returns 是否成功建立会话。
   * @throws 随机数或响应头写入失败时抛错。
   */
  consumeLaunchCode(code: string | null, response: ServerResponse): boolean {
    if (!code) return false;
    const expiration = this.codes.get(code);
    this.codes.delete(code);
    if (expiration === undefined || expiration <= this.options.now()) return false;
    const session = this.options.createSecret();
    this.sessions.add(session);
    response.setHeader(
      'Set-Cookie',
      `${this.getCookieName()}=${session}; HttpOnly; SameSite=Strict; Path=/`,
    );
    const observer = this.launchObservers.get(code);
    if (observer) {
      observer.session = session;
      this.sessionObservers.set(session, observer);
    }
    return true;
  }

  /**
   * 检查 API 会话以及 POST 的显式请求标记。
   * @param request 已通过 Host、Origin 检查的请求。
   * @returns 是否允许处理 API。
   * @throws 不抛出预期错误。
   */
  canAccessApi(request: IncomingMessage): boolean {
    return this.getApiFailure(request) === undefined;
  }

  /**
   * 区分请求标记错误和失效会话，供 API 返回可操作的原因类别。
   * @param request 已通过 Host、Origin 校验的请求。
   * @param isRequestMarkerRequired 某些路由对非 POST 请求也要求显式标记。
   * @returns 失败类别，允许访问时返回 undefined。
   * @throws 不抛出预期错误。
   */
  getApiFailure(
    request: IncomingMessage,
    isRequestMarkerRequired = false,
  ): ConnectionReason | undefined {
    if (
      (request.method === 'POST' || isRequestMarkerRequired) &&
      request.headers[REQUEST_HEADER] !== '1'
    )
      return 'permission';
    return this.readValidSession(request) ? undefined : 'session-expired';
  }

  /**
   * 确认成功的连接状态响应属于本次启动新建的会话。
   * @param request 已通过来源、会话校验并成功返回状态的请求。
   * @returns 无返回值；旧会话、失效会话或已经结束的观察不产生确认。
   * @throws 不抛出预期错误。
   */
  confirmApiAccess(request: IncomingMessage): void {
    const session = this.readValidSession(request);
    if (session) this.sessionObservers.get(session)?.finish(true);
  }

  private readValidSession(request: IncomingMessage): string | undefined {
    const cookieName = this.getCookieName();
    const values = (request.headers.cookie ?? '').split(';').map((part) => part.trim());
    const valid = values.filter(
      (part) =>
        part.startsWith(`${cookieName}=`) && this.sessions.has(part.slice(cookieName.length + 1)),
    );
    // 同一端口可能残留旧 cookie；忽略失效条目，但多个有效条目仍有身份歧义。
    return valid.length === 1 ? valid[0]!.slice(cookieName.length + 1) : undefined;
  }

  private getCookieName(): string {
    // 浏览器 cookie 不按端口隔离，名称必须包含端口以免多个工作台互相覆盖。
    return `${COOKIE_NAME_PREFIX}${this.options.getPort()}`;
  }
}
