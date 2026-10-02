import { useEffect, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

export const PAGE_SIZE = 20;

export function usePagedItems<T>(items: T[], pageSize = PAGE_SIZE) {
  const [requestedPage, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  useEffect(() => {
    if (requestedPage > pageCount) setPage(pageCount);
  }, [requestedPage, pageCount]);
  return { page, pageCount, setPage, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

export function Pagination({ page, pageCount, total, onPageChange }: {
  page: number; pageCount: number; total: number; onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return <nav className="list-pagination" aria-label="列表分页">
    <span>共 {total} 项 · 第 {page} / {pageCount} 页</span>
    <div>
      <button type="button" disabled={page === 1} onClick={() => onPageChange(page - 1)} aria-label="上一页" title="上一页"><CaretLeft size={16} /></button>
      <button type="button" disabled={page === pageCount} onClick={() => onPageChange(page + 1)} aria-label="下一页" title="下一页"><CaretRight size={16} /></button>
    </div>
  </nav>;
}
