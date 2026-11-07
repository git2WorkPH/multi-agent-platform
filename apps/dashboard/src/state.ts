import { useEffect, useState } from "react";
import type { DashboardApi } from "./api.ts";

type Page<T> = { items: T[]; nextCursor: string | null };
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Request failed";

export function useRequest<T>(load: (signal: AbortSignal) => Promise<T>, version = 0) {
  const [result, setResult] = useState<{ load: typeof load; value?: T; error?: string }>();
  const [pending, setPending] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    void load(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setResult({ load, value: result });
    }, reason => {
      if (!controller.signal.aborted) setResult(previous => ({
        load, value: previous?.load === load ? previous.value : undefined, error: errorMessage(reason),
      }));
    }).finally(() => {
      if (!controller.signal.aborted) setPending(false);
    });
    return () => controller.abort();
  }, [load, version]);
  return result?.load === load ? { value: result.value, error: result.error, pending } : { pending: true };
}

export function usePages<T>(load: (signal: AbortSignal, cursor?: string) => Promise<Page<T>>, version: number) {
  const [depth, setDepth] = useState(1);
  const [page, setPage] = useState<Page<T>>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    const refresh = async () => {
      let cursor: string | null = null;
      const items: T[] = [];
      for (let i = 0; i < depth; i++) {
        const next = await load(controller.signal, cursor ?? undefined);
        items.push(...next.items);
        cursor = next.nextCursor;
        if (!cursor) break;
      }
      return { items, nextCursor: cursor };
    };
    void refresh().then(value => {
      if (controller.signal.aborted) return;
      setPage(value);
      setError(undefined);
    }, reason => {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setPending(false);
    });
    return () => controller.abort();
  }, [load, depth, version]);
  return { page, error, pending, more: () => setDepth(current => current + 1) };
}

export function useLive(api: DashboardApi, project: string, refresh: () => void) {
  const [mode, setMode] = useState<"connecting" | "live" | "polling">("connecting");
  useEffect(() => {
    const controller = new AbortController();
    let polling: ReturnType<typeof setInterval> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let connection: AbortController | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    function watch(ms: number) {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => connection?.abort(), ms);
    }
    function connect() {
      connection = new AbortController();
      watch(5000);
      void api.stream(project, AbortSignal.any([controller.signal, connection.signal]), () => {
        watch(10000);
        clearInterval(polling);
        polling = undefined;
        setMode("live");
      }, refresh, () => watch(10000)).catch(() => {
        clearTimeout(watchdog);
        if (controller.signal.aborted) return;
        setMode("polling");
        if (!polling) {
          refresh();
          polling = setInterval(refresh, 2000);
        }
        reconnect = setTimeout(connect, 8000);
      });
    }
    connect();
    return () => {
      controller.abort();
      clearInterval(polling);
      clearTimeout(reconnect);
      clearTimeout(watchdog);
    };
  }, [api, project, refresh]);
  return mode;
}
