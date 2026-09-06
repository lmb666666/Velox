import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { VeloxMark } from '@/components/BrandLogo';
import { NavBar } from '@/components/NavBar';
import { TestForm } from '@/components/TestForm';
import { ResultPanel, type ResultPhase } from '@/components/ResultPanel';
import { HistoryPanel } from '@/components/HistoryPanel';
import { Button } from '@/components/ui/button';
import {
  clearHistory,
  createTest,
  deleteHistory,
  getHistory,
  getHistoryDetail,
  getNodes,
  refreshNodes,
  streamTest,
  type Frame,
  type HistoryDetail,
  type HistoryItem,
  type NodesResponse,
  type RunResult,
  type TestRequest,
} from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';

interface TaskState {
  id: string;
  phase: ResultPhase;
  frames: Frame[];
  statusLines: string[];
  result: RunResult | null;
  error?: string;
}

export default function App() {
  const [nodesData, setNodesData] = useState<NodesResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [task, setTask] = useState<TaskState | null>(null);
  const [viewHistory, setViewHistory] = useState<{ id: string; detail: HistoryDetail } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const closeStreamRef = useRef<(() => void) | null>(null);

  const loadNodes = useCallback(async () => {
    try {
      setNodesData(await getNodes());
    } catch (e) {
      toast.error(`节点表加载失败：${(e as Error).message}`);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setHistory((await getHistory()).items);
    } catch {
      /* 历史加载失败静默 */
    }
  }, []);

  useEffect(() => {
    loadNodes();
    loadHistory();
    return () => closeStreamRef.current?.();
  }, [loadNodes, loadHistory]);

  async function handleRefreshNodes() {
    setRefreshing(true);
    try {
      const r = await refreshNodes();
      toast.success(`节点表已刷新（${r.total} 个监测点）`);
      await loadNodes();
    } catch (e) {
      toast.error(`刷新失败：${(e as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSubmit(req: TestRequest) {
    closeStreamRef.current?.();
    setViewHistory(null);
    try {
      const { id } = await createTest(req);
      setTask({ id, phase: 'running', frames: [], statusLines: [], result: null });
      closeStreamRef.current = streamTest(id, {
        onSnapshot: (snap) => {
          setTask((t) =>
            t && t.id === id
              ? {
                  ...t,
                  frames: snap.frames ?? [],
                  result: snap.summary ? ({ summary: snap.summary, frames: snap.frames ?? [], finished: !!snap.finished, reason: snap.reason ?? '' } as RunResult) : null,
                }
              : t,
          );
        },
        onStatus: (line) => {
          setTask((t) => (t && t.id === id ? { ...t, statusLines: [...t.statusLines, line].slice(-6) } : t));
        },
        onFrame: (frame) => {
          setTask((t) => (t && t.id === id ? { ...t, frames: [...t.frames, frame] } : t));
        },
        onDone: (result) => {
          setTask((t) => (t && t.id === id ? { ...t, phase: 'done', result } : t));
          toast.success(`测试完成：${result.summary.okNodes}/${result.summary.totalNodes} 节点成功`);
          loadHistory();
        },
        onError: (message) => {
          setTask((t) => (t && t.id === id ? { ...t, phase: 'error', error: message } : t));
          toast.error(message);
          loadHistory();
        },
        onState: (state) => {
          if (state === 'queued') {
            setTask((t) => (t && t.id === id ? { ...t, statusLines: [...t.statusLines, '任务排队中（同一时间仅执行一个任务）…'] } : t));
          }
        },
      });
    } catch (e) {
      toast.error(`创建任务失败：${(e as Error).message}`);
    }
  }

  async function handleOpenHistory(id: string) {
    setLoadingDetail(true);
    try {
      const detail = await getHistoryDetail(id);
      setViewHistory({ id, detail });
    } catch (e) {
      toast.error(`读取历史失败：${(e as Error).message}`);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleDeleteHistory(id: string) {
    try {
      await deleteHistory(id);
      setHistory((h) => h.filter((x) => x.id !== id));
      if (viewHistory?.id === id) setViewHistory(null);
      toast.success('记录已删除');
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    }
  }

  async function handleClearHistory() {
    try {
      await clearHistory();
      setHistory([]);
      setViewHistory(null);
      toast.success('历史记录已清空');
    } catch (e) {
      toast.error(`清空失败：${(e as Error).message}`);
    }
  }

  // 结果区数据源：优先当前任务，否则回看的历史记录
  const view = viewHistory
    ? {
        phase: (viewHistory.detail.error && !viewHistory.detail.summary ? 'error' : 'done') as ResultPhase,
        frames: viewHistory.detail.frames,
        statusLines: [] as string[],
        result: {
          summary: viewHistory.detail.summary,
          frames: viewHistory.detail.frames,
          finished: viewHistory.detail.finished,
          reason: viewHistory.detail.reason,
        },
        error: viewHistory.detail.error,
        taskId: viewHistory.id,
      }
    : task
      ? { phase: task.phase, frames: task.frames, statusLines: task.statusLines, result: task.result, error: task.error, taskId: task.id }
      : null;

  const running = task?.phase === 'running';

  return (
    <div className="min-h-screen">
      {/* 顶部品牌氛围光（深色下可见的微弱青色光晕） */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-0 h-64 bg-[radial-gradient(ellipse_60%_60%_at_50%_-10%,hsl(170_100%_45%/0.10),transparent)]" />

      <NavBar running={running} nodesTotal={nodesData?.total} />

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-8 pt-24 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
          <div className="space-y-4">
            <TestForm
              running={running}
              nodesData={nodesData}
              refreshingNodes={refreshing}
              onRefreshNodes={handleRefreshNodes}
              onSubmit={handleSubmit}
            />
            <HistoryPanel
              items={history}
              onOpen={handleOpenHistory}
              onDelete={handleDeleteHistory}
              onClear={handleClearHistory}
              onRefresh={loadHistory}
              activeId={viewHistory?.id ?? (task?.phase === 'done' ? task.id : undefined)}
            />
          </div>
          <div className="flex flex-col space-y-3">
            {viewHistory && (
              <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                <span>
                  正在回看历史记录 <span className="num font-medium">{viewHistory.id}</span>
                  {running && <span className="ml-2 text-muted-foreground">（新测试仍在后台进行）</span>}
                </span>
                <Button variant="ghost" size="sm" className="h-7" onClick={() => setViewHistory(null)}>
                  返回最新结果
                </Button>
              </div>
            )}
            {loadingDetail ? (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : view ? (
              <ResultPanel
                phase={view.phase}
                frames={view.frames}
                statusLines={view.statusLines}
                result={view.result}
                error={view.error}
                taskId={view.taskId}
              />
            ) : (
              <ResultPanel phase="idle" frames={[]} statusLines={[]} result={null} />
            )}
          </div>
        </div>

        <footer className="mt-10 flex flex-col items-center gap-1.5 border-t pt-6 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <VeloxMark size={16} variant="mono" className="opacity-60" />
            <span>
              Velox · Inspect. Select. Accelerate.
            </span>
          </div>
          <span>数据来源 itdog.cn · 非官方接口，仅供学习与个人测速，请控制频率</span>
        </footer>
      </main>
    </div>
  );
}
