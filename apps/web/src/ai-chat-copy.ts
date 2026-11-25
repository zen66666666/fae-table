// 集中定义单据 AI 对话和回复操作的中文文案，供右栏助手使用。
import type { AiChatOutcome, AiChatSummary } from '../../../packages/core/src/index.ts';

/** 对话输入、发送范围、消息状态和回复动作文案。 */
export const AI_CHAT_COPY = {
  privacy: '问答加密保存在本机，只发给你配置的 AI 接口',
  placeholder: '输入问题，Enter 发送',
  expandAssistant: '放大',
  collapseAssistant: '收起',
  send: '发送',
  stop: '停止',
  stopping: '正在停止…',
  stopFailed: '未能停止回答，请重试。',
  modelsBusy: '有回答正在进行',
  formatWaiting: (seconds: number): string => `正在等待回答，已等待 ${seconds} 秒`,
  formatThinking: (seconds: number): string => `思考中… 已思考 ${seconds} 秒`,
  askAgain: '重新提问',
  historyLoading: '正在读取对话…',
  historyFailed: '对话记录读取失败',
  historySaveFailed: 'AI 记录未能保存到本机',
  clearHistory: '清空本单',
  clearHistoryConfirm: '确定清空本单 AI 记录？',
  clearingHistory: '正在清空…',
  historyClearFailed: 'AI 记录清空失败',
  retry: '重试',
  question: '我的提问',
  answer: 'AI 回答',
  context: '本次发给 AI 的内容',
  fields: '表单',
  fieldUnit: '项',
  records: '沟通记录',
  recordUnit: '条',
  manualChunks: '手册段落',
  manualChunkUnit: '段',
  formatPages: (pages: number[]): string => `（第 ${pages.join('、')} 页）`,
  researchers: '研发人员',
  researcherUnit: '位',
  noManual: '未参考手册',
  noManualText: '无法读取文字',
  append: '放入我的回复',
  appendDone: '已放入我的回复',
  appendTooLong: '回复空间不足，请复制后自行调整，原回复已保留。',
  appendUnavailable: '当前回复框暂不可编辑',
  copy: '复制',
  copyDone: '已复制',
  copyFailed: '复制失败，请手动选择并复制。',
  quickQuestions: '可以直接提问，也可以选一个常用问题',
} as const;

/** 尚无问答时可填入输入框的常用问题。 */
export const AI_QUICK_QUESTIONS = [
  '根据手册分析可能的原因',
  '帮我写一段给客户的回复',
  '列出需要客户补充的信息',
] as const;

/**
 * 将后端实际删减的数量组合为固定中文提示，无删减时不显示提示。
 * @param trimmed 本轮已省略的各类输入数量及其他文字的截短标记。
 * @returns 本轮删减提示，无删减时为空字符串。
 * @throws 无预期错误。
 */
export function formatAiChatTrimmed(trimmed: AiChatSummary['trimmed']): string {
  if (!trimmed) return '';
  const {
    records,
    manualPassages,
    historyTurns,
    isOtherContentTrimmed,
    fields = 0,
    researchers = 0,
    attachments = 0,
    handlers = 0,
  } = trimmed;
  const omitted = [
    records > 0 ? `${records} 条较早的沟通记录` : '',
    manualPassages > 0 ? `${manualPassages} 段手册摘录` : '',
    historyTurns > 0 ? `${historyTurns} 轮较早的问答` : '',
    fields > 0 ? `${fields} 项表单` : '',
    researchers > 0 ? `${researchers} 位研发候选` : '',
    attachments > 0 ? `${attachments} 个附件名称` : '',
    handlers > 0 ? `${handlers} 位处理人` : '',
  ].filter(Boolean);
  const parts = [
    omitted.length ? `省略了 ${omitted.join('、')}` : '',
    isOtherContentTrimmed ? '截短了部分文字' : '',
  ].filter(Boolean);
  return parts.length ? `为控制长度，${parts.join('，')}` : '';
}

/** 后台安全结束类别对应的提示；正常结束无需额外文案。 */
export const AI_CHAT_OUTCOME_LABELS: Record<AiChatOutcome['kind'], string> = {
  complete: '',
  truncated: "回答较长已被截断，可以继续提问'继续'",
  'no-answer': '模型思考时间过长，没有给出回答。可以再问一次，或换一个模型。',
  timeout: 'AI 响应超时',
  'invalid-key': 'API Key 无效，请在连接设置中检查。',
  'rate-limited': 'AI 接口请求过多，请稍后重试。',
  'service-error': 'AI 接口暂时无法完成请求，请重试。',
  unreachable: '无法连接 AI 接口，请检查网络或接口地址。',
  stopped: '已停止生成',
  'detail-unavailable': '尚未取得单据详情，请稍后重试。',
};
