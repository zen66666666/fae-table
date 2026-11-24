// 从工作簿和关系 XML 解析目标工作表、共享文本部件及 Excel 日期起点。
import { AppError } from '../../core/src/index.ts';
import { isArchivePartPath } from './archive.ts';
import { readXml, readXmlAttribute } from './xml.ts';

const REQUIRED_SHEET_NAME = '产品固件';
const SHEET_NAMES = [REQUIRED_SHEET_NAME, '工装固件', '工业物联移交'] as const;
const TARGET_SHEETS = new Set<string>(SHEET_NAMES);
const INTERNAL_TARGET = 'Internal';
const WORKSHEET_RELATION = '/worksheet';
const STRINGS_RELATION = '/sharedStrings';

type Relationship = { target: string; type: string; isExternal: boolean };

/** 已校验的目标工作表和可选共享文本在归档内的位置。 */
export type WorkbookParts = { worksheets: string[]; sharedStrings?: string; isDate1904: boolean };

function createInvalidWorkbookError(): AppError {
  return new AppError('structure', 'invalid_codetable_workbook', 'codetable');
}

function readRelationships(xml: string): Map<string, Relationship> {
  const relations = new Map<string, Relationship>();
  for (const event of readXml(xml)) {
    if (event.kind !== 'start' || event.name !== 'Relationship') continue;
    const id = event.attributes.get('Id');
    const target = event.attributes.get('Target');
    const type = event.attributes.get('Type');
    if (!id || !target || !type || relations.has(id)) throw createInvalidWorkbookError();
    const mode = event.attributes.get('TargetMode');
    relations.set(id, { target, type, isExternal: mode !== undefined && mode !== INTERNAL_TARGET });
  }
  return relations;
}

function getInternalPart(target: string): string {
  const member = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  // 仅读取工作簿内部的 XML，不能按外部链接或父路径读取任意文件。
  if (!isArchivePartPath(member) || !member.endsWith('.xml')) throw createInvalidWorkbookError();
  return member;
}

function readSheetNames(xml: string): { sheets: Map<string, string>; isDate1904: boolean } {
  const sheets = new Map<string, string>();
  let isDate1904 = false;
  for (const event of readXml(xml)) {
    if (event.kind !== 'start') continue;
    if (event.name === 'workbookPr') {
      const date1904 = event.attributes.get('date1904');
      isDate1904 = date1904 === '1' || date1904 === 'true';
    }
    const name = event.attributes.get('name');
    if (event.name !== 'sheet' || !name || !TARGET_SHEETS.has(name)) continue;
    const relation = readXmlAttribute(event.attributes, 'id');
    if (!relation || sheets.has(name)) throw createInvalidWorkbookError();
    sheets.set(name, relation);
  }
  return { sheets, isDate1904 };
}

/**
 * 解析固定目标页的关系映射，并获得行日期所用的 Excel 日期系统。
 * @param options 工作簿 XML 以及该工作簿的关系 XML。
 * @returns 按指定页顺序排列的路径、共享文本路径和日期系统。
 * @throws AppError 产品固件缺失，或实际存在的目标页关系、路径无效。
 */
export function readWorkbookParts(options: {
  workbook: string;
  relationships: string;
}): WorkbookParts {
  // 1. 分别解读页名、日期设置与部件关系。2. 只挑选实际存在的目标页和共享字符串部件。
  const { sheets, isDate1904 } = readSheetNames(options.workbook); // 1.
  if (!sheets.has(REQUIRED_SHEET_NAME)) throw createInvalidWorkbookError();
  const relationships = readRelationships(options.relationships);
  const worksheets = SHEET_NAMES.filter((name) => sheets.has(name)).map((name) => {
    // 2.
    const relation = relationships.get(sheets.get(name) ?? '');
    if (!relation?.type.endsWith(WORKSHEET_RELATION) || relation.isExternal)
      throw createInvalidWorkbookError();
    const member = getInternalPart(relation.target);
    if (!member.startsWith('xl/worksheets/')) throw createInvalidWorkbookError();
    return member;
  });
  if (new Set(worksheets).size !== worksheets.length) throw createInvalidWorkbookError();
  const strings = [...relationships.values()].find((entry) =>
    entry.type.endsWith(STRINGS_RELATION),
  );
  if (strings?.isExternal) throw createInvalidWorkbookError();
  return {
    worksheets,
    isDate1904,
    sharedStrings: strings ? getInternalPart(strings.target) : undefined,
  };
}
