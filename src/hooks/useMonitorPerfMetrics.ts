import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 감독관 모니터링 화면 성능 지표
 *
 * 추적 항목:
 *  - queryCount: 누적 DB 쿼리 횟수 (initial fetch + 부분 갱신)
 *  - eventCount: 수신한 realtime 이벤트 누적 수
 *  - lastLatencyMs: 마지막 이벤트의 발생→수신 지연 시간 (ms)
 *  - avgLatencyMs: 최근 20건의 평균 지연 시간
 *  - maxLatencyMs: 최대 지연 시간
 *  - lastUpdate: 마지막 상태 갱신 시각
 */
export interface MonitorPerfMetrics {
  queryCount: number;
  eventCount: number;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  lastUpdate: number | null;
}

const INITIAL: MonitorPerfMetrics = {
  queryCount: 0,
  eventCount: 0,
  lastLatencyMs: null,
  avgLatencyMs: null,
  maxLatencyMs: null,
  lastUpdate: null,
};

export function useMonitorPerfMetrics() {
  const [metrics, setMetrics] = useState<MonitorPerfMetrics>(INITIAL);
  const samplesRef = useRef<number[]>([]); // 최근 지연 샘플 (rolling window)
  const maxSamples = 20;

  const trackQuery = useCallback(() => {
    setMetrics(m => ({ ...m, queryCount: m.queryCount + 1, lastUpdate: Date.now() }));
  }, []);

  /**
   * 이벤트 도착 시 호출. originTs 가 있으면 지연 시간을 계산합니다.
   * @param originTs 이벤트 발생 시각 (ISO string 또는 ms epoch)
   */
  const trackEvent = useCallback((originTs?: string | number | null) => {
    const now = Date.now();
    let latencyMs: number | null = null;
    if (originTs != null) {
      const t = typeof originTs === 'string' ? new Date(originTs).getTime() : originTs;
      if (!Number.isNaN(t) && t > 0) {
        latencyMs = Math.max(0, now - t);
        const arr = samplesRef.current;
        arr.push(latencyMs);
        if (arr.length > maxSamples) arr.shift();
      }
    }
    setMetrics(m => {
      const arr = samplesRef.current;
      const avg = arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : m.avgLatencyMs;
      const max = arr.length ? Math.max(...arr) : m.maxLatencyMs;
      return {
        ...m,
        eventCount: m.eventCount + 1,
        lastLatencyMs: latencyMs ?? m.lastLatencyMs,
        avgLatencyMs: avg,
        maxLatencyMs: max,
        lastUpdate: now,
      };
    });
  }, []);

  const reset = useCallback(() => {
    samplesRef.current = [];
    setMetrics(INITIAL);
  }, []);

  return { metrics, trackQuery, trackEvent, reset };
}

/** 헤더 패널용 */
export interface MonitorPerfMetricsExtra extends MonitorPerfMetrics {
  sessionsCached: number;
}
