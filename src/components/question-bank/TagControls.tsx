import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tag, Plus, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 모든 문제의 tags 배열에서 유니크 태그 + 사용 빈도 추출
 */
export function collectTagStats(questions: { tags?: string[] | null }[]): { tag: string; count: number }[] {
  const map = new Map<string, number>();
  for (const q of questions) {
    for (const t of q.tags || []) {
      const v = (t || '').trim();
      if (!v) continue;
      map.set(v, (map.get(v) || 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'));
}

/* ------------------------------------------------------------------ */
/* 필터용: 다중 선택 (OR 매칭)                                          */
/* ------------------------------------------------------------------ */
interface TagFilterPopoverProps {
  allTags: { tag: string; count: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}

export function TagFilterPopover({ allTags, selected, onChange, className }: TagFilterPopoverProps) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return allTags;
    return allTags.filter(t => t.tag.toLowerCase().includes(s));
  }, [allTags, search]);

  const toggle = (tag: string) => {
    if (selected.includes(tag)) onChange(selected.filter(t => t !== tag));
    else onChange([...selected, tag]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('text-[12px] h-8 gap-1', selected.length > 0 && 'border-primary text-primary', className)}
        >
          <Tag className="h-3.5 w-3.5" />
          태그
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">{selected.length}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="태그 검색"
              className="pl-7 h-7 text-[12px]"
            />
          </div>
          {selected.length > 0 && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-muted-foreground">{selected.length}개 선택됨 (OR 매칭)</span>
              <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => onChange([])}>전체 해제</Button>
            </div>
          )}
        </div>
        <div className="max-h-[260px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="text-center text-[11px] text-muted-foreground py-4">
              {allTags.length === 0 ? '등록된 태그가 없습니다' : '일치하는 태그 없음'}
            </div>
          )}
          {filtered.map(({ tag, count }) => {
            const checked = selected.includes(tag);
            return (
              <label
                key={tag}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted text-[12px]',
                  checked && 'bg-primary/5'
                )}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(tag)} />
                <span className="flex-1 truncate">{tag}</span>
                <span className="text-[10px] text-muted-foreground">{count}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* 편집용: 기존 태그 체크박스 선택 + 새 태그 추가                        */
/* ------------------------------------------------------------------ */
interface TagPickerPopoverProps {
  allTags: { tag: string; count: number }[];
  value: string[];
  onChange: (next: string[]) => void;
}

export function TagPickerPopover({ allTags, value, onChange }: TagPickerPopoverProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return allTags;
    return allTags.filter(t => t.tag.toLowerCase().includes(s));
  }, [allTags, search]);

  const exists = (tag: string) => allTags.some(t => t.tag.toLowerCase() === tag.toLowerCase());
  const canAddNew = search.trim().length > 0 && !exists(search.trim()) && !value.includes(search.trim());

  const toggle = (tag: string) => {
    if (value.includes(tag)) onChange(value.filter(t => t !== tag));
    else onChange([...value, tag]);
  };

  const addNew = () => {
    const tag = search.trim();
    if (!tag) return;
    if (!value.includes(tag)) onChange([...value, tag]);
    setSearch('');
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1">
          <Plus className="h-3.5 w-3.5" />
          태그 선택 / 추가
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <div className="p-2 border-b">
          <div className="flex gap-1">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && canAddNew) {
                    e.preventDefault();
                    addNew();
                  }
                }}
                placeholder="기존 태그 검색 또는 새 태그 입력"
                className="pl-7 h-7 text-[12px]"
              />
            </div>
            {canAddNew && (
              <Button size="sm" className="h-7 text-[11px]" onClick={addNew}>
                + 추가
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            기존 태그는 체크박스로 선택하고, 없는 태그는 입력 후 Enter 또는 [+추가]
          </p>
        </div>
        <div className="max-h-[260px] overflow-y-auto p-1">
          {filtered.length === 0 && !canAddNew && (
            <div className="text-center text-[11px] text-muted-foreground py-4">
              {allTags.length === 0 ? '등록된 태그가 없습니다' : '일치하는 태그 없음'}
            </div>
          )}
          {filtered.map(({ tag, count }) => {
            const checked = value.includes(tag);
            return (
              <label
                key={tag}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted text-[12px]',
                  checked && 'bg-primary/5'
                )}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(tag)} />
                <span className="flex-1 truncate">{tag}</span>
                <span className="text-[10px] text-muted-foreground">{count}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* 선택된 태그 chips (제거 가능)                                        */
/* ------------------------------------------------------------------ */
export function SelectedTagChips({
  tags,
  onRemove,
  className,
}: {
  tags: string[];
  onRemove: (tag: string) => void;
  className?: string;
}) {
  if (tags.length === 0) return null;
  return (
    <div className={cn('flex gap-1 flex-wrap', className)}>
      {tags.map(t => (
        <Badge key={t} variant="secondary" className="text-[11px] gap-1 pr-1">
          {t}
          <button onClick={() => onRemove(t)} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
