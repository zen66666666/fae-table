// 建立标准化型号的内存索引并聚合责任人，后台通过模块入口调用。
import type { CodeTableMatch, CodeTablePerson } from '../../core/src/index.ts';
import { normalizeModel } from './firmware-rows.ts';
import type { FirmwareRow } from './firmware-rows.ts';

const MAX_TICKET_PREFIX_MATCHES = 5;

/** 一次成功加载的码表；计数和查询只依赖内存索引。 */
export type CodeTableIndex = {
  readonly modelCount: number;
  readonly peopleCount: number;
  match: (model: string) => CodeTableMatch[];
};

function compareArchiveDates(left: string | null, right: string | null): number {
  // ISO 日历日期可按文本比较；没有实际日期的记录排在最后。
  return (left ?? '').localeCompare(right ?? '');
}

function mergePerson(options: {
  row: FirmwareRow;
  name: string;
  entry: CodeTablePerson | undefined;
}): CodeTablePerson {
  const { row, name, entry } = options;
  const count = (entry?.recordCount ?? 0) + 1;
  if (entry && compareArchiveDates(entry.archivedAt, row.archivedAt) >= 0) {
    return { ...entry, recordCount: count };
  }
  return {
    name,
    recordCount: count,
    archivedAt: row.archivedAt,
    code: row.code,
    chip: row.chip,
    summary: row.summary,
  };
}

function findFirstModel(models: readonly string[], prefix: string): number {
  let start = 0;
  let end = models.length;
  while (start < end) {
    const candidate = Math.floor((start + end) / 2);
    if (models[candidate] < prefix) start = candidate + 1;
    else end = candidate;
  }
  return start;
}

function findMatches(options: {
  tables: ReadonlyMap<string, CodeTablePerson[]>;
  models: readonly string[];
  model: string;
}): CodeTableMatch[] {
  // 1. 精确匹配。2. 查找最长的表内前缀。3. 返回按型号排序的反向前缀匹配。
  const { tables, models, model } = options;
  const key = normalizeModel(model);
  if (!key) return [];
  const build = (candidate: string, kind: CodeTableMatch['kind']): CodeTableMatch => ({
    model: candidate,
    kind,
    people: (tables.get(candidate) ?? []).map((person) => ({ ...person })),
  });
  if (tables.has(key)) return [build(key, 'exact')]; // 1.
  for (let length = key.length - 1; length > 0; length--) {
    // 2.
    const candidate = key.slice(0, length);
    if (tables.has(candidate)) return [build(candidate, 'table-prefix')];
  }
  const first = findFirstModel(models, key); // 3. 复用排序的键，避免查询时重复扫描表。
  const matches: CodeTableMatch[] = [];
  for (const candidate of models.slice(first, first + MAX_TICKET_PREFIX_MATCHES)) {
    if (!candidate.startsWith(key)) break;
    matches.push(build(candidate, 'ticket-prefix'));
  }
  return matches;
}

/** 逐页聚合固件行，构建过程不保留完整工作表记录。 */
export class CodeTableIndexBuilder {
  private byModel = new Map<string, Map<string, CodeTablePerson>>();
  private names = new Set<string>();

  /**
   * 合并一页有效固件行，同一行的重复型号仅计一次。
   * @param records 解析器按表格顺序提供的行。
   * @returns 无返回值。
   * @throws 只传播上游流式解析错误。
   */
  append(records: Iterable<FirmwareRow>): void {
    for (const row of records) {
      for (const model of row.models) {
        let people = this.byModel.get(model);
        if (!people) {
          people = new Map();
          this.byModel.set(model, people);
        }
        if (row.person) {
          this.names.add(row.person);
          people.set(
            row.person,
            mergePerson({ row, name: row.person, entry: people.get(row.person) }),
          );
        }
      }
    }
  }

  /**
   * 根据全表的型号与责任人统计生成可复用的查找快照。
   * @returns 独立快照，匹配结果按最近归档日期排序。
   * @throws 无预期错误。
   */
  build(): CodeTableIndex {
    const tables = new Map<string, CodeTablePerson[]>();
    const models = [...this.byModel.keys()].sort();
    for (const model of models) {
      const people = [...(this.byModel.get(model)?.values() ?? [])];
      people.sort((left, right) => compareArchiveDates(right.archivedAt, left.archivedAt));
      tables.set(model, people);
    }
    return {
      modelCount: tables.size,
      peopleCount: this.names.size,
      match: (model) => findMatches({ tables, models, model }),
    };
  }
}
