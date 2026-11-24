// 集中定义沟通记录的动作译名和固定文案，由评论气泡及系统动作展示复用。

/** 已明确含义的动作代码；未知代码保留原文，避免猜测审批动作。 */
export const TICKET_ACTION_LABELS: Readonly<Record<string, string>> = {
  COMMENT: '添加了评论',
  START: '发起了流程',
  CC: '抄送',
  AGREE: '同意',
  REFUSE: '拒绝',
  START_PROCESS_INSTANCE: '发起了流程',
  PROCESS_CC: '抄送',
  EXECUTE_TASK_NORMAL: '处理了任务',
  ADD_REMARK: '添加了评论',
};

/** 已明确含义的处理结果；未识别的结果仍展示原代码。 */
export const TICKET_RESULT_LABELS: Readonly<Record<string, string>> = {
  AGREE: '同意',
  REFUSE: '拒绝',
};

/** 沟通区标题、媒体数量和附件名称的统一文案。 */
export const TICKET_RECORD_COPY = {
  title: '沟通记录',
  jumpToLatest: '跳到最新',
  empty: '暂无沟通记录。',
  openImage: '打开图片',
  imageViewer: '图片查看',
  imageLoading: '图片加载中…',
  imageFailed: '图片加载失败',
  previousImage: '上一张',
  nextImage: '下一张',
  closeImage: '关闭',
  attachmentsLabel: '附件',
  passed: '通过',
  formatPassedStep: (name: string): string => `通过「${name}」`,
  recipientsSuffix: ' 人',
} as const;
