// 展示一个已匹配型号及其前几名研发人员，供单据人员区域使用。
import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import type { CodeTableMatch } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import { CODETABLE_COPY, CODETABLE_MATCH_LABELS } from './codetable-copy.ts';
import { CodeTablePersonCard } from './codetable-person.tsx';

const INITIAL_PEOPLE_COUNT = 5;

/** 后台已排序的型号和人员列表。 */
export type CodeTableMatchCardProps = { match: CodeTableMatch };

/**
 * 保留后台人员顺序，默认显示前五人，用户可查看剩余人员。
 * @param props 型号、匹配方式和聚合人员列表。
 * @returns 带匹配标记且可以展开的型号区块。
 * @throws 无预期错误。
 */
export function CodeTableMatchCard({ match }: CodeTableMatchCardProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(false);
  const peopleId = useId();
  const people = isExpanded ? match.people : match.people.slice(0, INITIAL_PEOPLE_COUNT);
  return (
    <section className="codetable-match">
      <div className="codetable-match-heading">
        <h4>{match.model}</h4>
        <span
          className={`status-tag status-tag--${match.kind === 'exact' ? 'ready' : 'action-required'}`}
        >
          {CODETABLE_MATCH_LABELS[match.kind]}
        </span>
      </div>
      {people.length ? (
        <ol className="codetable-people" id={peopleId}>
          {people.map((person) => (
            <CodeTablePersonCard key={person.name} person={person} />
          ))}
        </ol>
      ) : (
        <p className="muted">{CODETABLE_COPY.noPeople}</p>
      )}
      {match.people.length > INITIAL_PEOPLE_COUNT && (
        <Button
          variant="quiet"
          aria-expanded={isExpanded}
          aria-controls={peopleId}
          onClick={() => setIsExpanded((value) => !value)}
        >
          {isExpanded ? CODETABLE_COPY.collapsePeople : CODETABLE_COPY.expandPeople}
        </Button>
      )}
    </section>
  );
}
