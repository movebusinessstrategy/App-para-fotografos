import { useCallback, useMemo } from 'react';
import useSWRInfinite from 'swr/infinite';
import { useApi } from '../../utils/useApi';
import { CONFIG_URL, OVERVIEW_URL, dealStateUrl, fetchJson, queueUrl } from './api';
import type {
  DealFollowUpState, FollowUpConfigResponse, FollowUpDraftItem, FollowUpOverview, FollowUpQueueResponse,
  FollowUpStep, QueueTab,
} from './types';

// O SWR já pausa o polling com a aba oculta e revalida ao voltar o foco.

export function useFollowUpOverview() {
  return useApi<FollowUpOverview>(OVERVIEW_URL, {
    refreshInterval: (d?: FollowUpOverview) => (d?.sweep?.running ? 4000 : 20000),
    dedupingInterval: 3000,
    revalidateOnFocus: true,
  });
}

export function useFollowUpConfig(active: boolean) {
  return useApi<FollowUpConfigResponse>(active ? CONFIG_URL : null, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });
}

export function useDealFollowUp(dealId: number | string | null | undefined) {
  return useApi<DealFollowUpState>(dealId ? dealStateUrl(dealId) : null, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
    shouldRetryOnError: false,
  });
}

export const QUEUE_PAGE_SIZE = 20;
const QUEUE_PREVIEW = 6;

export interface QueueFilters {
  status: QueueTab;
  step: FollowUpStep | null;
  stageId: string | null;
  dealId: number | null;
  search: string;
}

function lastPageDone(prev: FollowUpQueueResponse | null): boolean {
  if (!prev) return false;
  return prev.offset + prev.items.length >= prev.total || prev.items.length === 0;
}

function uniqueItems(pages: FollowUpQueueResponse[]): FollowUpDraftItem[] {
  const seen = new Set<number>();
  const out: FollowUpDraftItem[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

// Fila paginada por offset ("Carregar mais"). paused = algum card em edição.
export function useFollowUpQueue(filters: QueueFilters, paused: boolean) {
  const { status, step, stageId, dealId, search } = filters;
  const getKey = useCallback((index: number, prev: FollowUpQueueResponse | null) => {
    if (index > 0 && lastPageDone(prev)) return null;
    return queueUrl({
      status, step, stage_id: stageId, deal_id: dealId, search,
      offset: index * QUEUE_PAGE_SIZE, limit: QUEUE_PAGE_SIZE, preview: QUEUE_PREVIEW,
    });
  }, [status, step, stageId, dealId, search]);

  const swr = useSWRInfinite<FollowUpQueueResponse, Error>(getKey, fetchJson, {
    refreshInterval: paused ? 0 : 30000,
    revalidateOnFocus: !paused,
    dedupingInterval: 4000,
    keepPreviousData: true,
    revalidateFirstPage: true,
  });

  const pages = useMemo(() => swr.data ?? [], [swr.data]);
  const items = useMemo(() => uniqueItems(pages), [pages]);
  const first = pages[0];
  const hasMore = pages.length > 0 && !lastPageDone(pages[pages.length - 1]);

  const { mutate, setSize, size } = swr;
  const removeLocal = useCallback((id: number) => {
    void mutate((current) => current?.map((p) => dropItem(p, id)), { revalidate: false });
  }, [mutate]);

  const replaceLocal = useCallback((item: FollowUpDraftItem) => {
    void mutate((current) => current?.map((p) => swapItem(p, item)), { revalidate: false });
  }, [mutate]);

  return {
    items,
    total: first?.total ?? 0,
    serverTime: first?.server_time ?? null,
    error: swr.error,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    hasMore,
    loadMore: () => setSize(size + 1),
    refresh: () => mutate(),
    removeLocal,
    replaceLocal,
  };
}

function dropItem(page: FollowUpQueueResponse, id: number): FollowUpQueueResponse {
  if (!page.items.some((i) => i.id === id)) return page;
  return { ...page, items: page.items.filter((i) => i.id !== id), total: Math.max(0, page.total - 1) };
}

function swapItem(page: FollowUpQueueResponse, item: FollowUpDraftItem): FollowUpQueueResponse {
  if (!page.items.some((i) => i.id === item.id)) return page;
  return { ...page, items: page.items.map((i) => (i.id === item.id ? item : i)) };
}
