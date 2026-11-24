// 为 Skill 启动器提供已有实例发现和退出接口，锁内容及控制秘密始终留在后台模块。
import { AppError } from '../../../packages/core/src/index.ts';
import { resolveServerContext } from './dependencies.ts';
import {
  isInstanceHealthy,
  openHealthyInstance,
  reuseHealthyInstance,
  stopHealthyInstance,
} from './instance-control.ts';
import { readInstanceLock } from './instance-lock.ts';
import type {
  InstanceLock,
  ServerControlOptions,
  ServerDependencies,
  StartedServer,
  RunningInstance,
} from './types.ts';

const STOP_WAIT_MS = 5_000;
const STOP_POLL_MS = 100;

type HealthyInstance = { lock: InstanceLock; dependencies: ServerDependencies };

async function findHealthyInstance(
  options: ServerControlOptions,
): Promise<HealthyInstance | undefined> {
  const { dataDir, dependencies } = resolveServerContext(options);
  const lock = readInstanceLock({ dataDir, dependencies });
  if (!lock || lock.port === 0 || !dependencies.isProcessAlive(lock.pid)) return;
  const instance = { lock, dependencies };
  // 端口、PID 和控制秘密共同证明实例身份，不能把其他程序当成工作台控制。
  return (await isInstanceHealthy(instance)) ? instance : undefined;
}

/**
 * 查询通过密钥健康检查的已有实例，不生成一次性启动码。
 * @param options 数据目录和可替换运行依赖，默认使用用户运行目录。
 * @returns 实例端口；不存在或锁残留时返回 undefined。
 * @throws AppError：数据目录或锁无法读取。
 */
export async function getRunningInstance(
  options: ServerControlOptions = {},
): Promise<RunningInstance | undefined> {
  try {
    const instance = await findHealthyInstance(options);
    return instance ? { port: instance.lock.port } : undefined;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('configuration', 'server_discovery_failed', 'server');
  }
}

/**
 * 查询已有健康实例并获取一次性启动地址，不创建后台或读取账号配置。
 * @param options 数据目录和可替换运行环境，默认使用用户运行目录。
 * @returns 可复用实例的句柄；不存在或锁残留时返回 undefined。
 * @throws AppError：锁不可读取、配置无效或健康实例无法提供启动地址。
 */
export async function getRunningServer(
  options: ServerControlOptions = {},
): Promise<StartedServer | undefined> {
  try {
    const instance = await findHealthyInstance(options);
    return instance ? await reuseHealthyInstance(instance) : undefined;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('configuration', 'server_discovery_failed', 'server');
  }
}

/**
 * 让已运行后台打开工作台页面，并确认本次新会话成功读取到连接状态。
 * @param options 数据目录和可替换运行依赖；不会新建服务或接受任意 URL。
 * @returns 已打开并到达页面的服务端口。
 * @throws AppError：服务不在运行、配置无效、浏览器分派失败或页面到达超时。
 */
export async function openRunningServer(options: ServerControlOptions = {}): Promise<number> {
  // 1. 确认实例身份；2. 由常驻后台派发浏览器并等待本次页面到达。
  try {
    const instance = await findHealthyInstance(options);
    if (!instance) throw new AppError('configuration', 'server_not_running', 'server');
    // 2. 浏览器分派脱离短时启动器生命周期，整个动作不向调用方暴露会话凭证。
    return await openHealthyInstance(instance);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('process', 'browser_open_failed', 'server');
  }
}

/**
 * 请求已有健康实例退出，并等待其健康接口停止响应。
 * @param options 数据目录和可替换运行环境。
 * @returns 已请求关闭并确认停止时为 true；没有运行中的工作台时为 false。
 * @throws AppError：配置、关闭请求失败或服务未能在时限内停止。
 */
export async function stopServer(options: ServerControlOptions = {}): Promise<boolean> {
  // 1. 确认实例身份；2. 请求服务自行退出；3. 有界等待，不终止任何其他进程。
  try {
    const instance = await findHealthyInstance(options);
    if (!instance) return false;
    // 2. 沿用后台已有的密钥控制接口，不新增网页权限或任意命令接口。
    await stopHealthyInstance(instance);
    // 3. 控制响应完成后后台才开始清理，因此需等其停止响应再向用户报告完成。
    for (let attempt = 0; attempt < STOP_WAIT_MS / STOP_POLL_MS; attempt++) {
      if (!(await isInstanceHealthy(instance))) return true;
      await instance.dependencies.wait(STOP_POLL_MS);
    }
    throw new AppError('process', 'server_stop_timeout', 'server');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('process', 'server_stop_failed', 'server');
  }
}
