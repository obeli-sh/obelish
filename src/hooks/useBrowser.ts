import { useState, useCallback, useRef } from 'react';

export function useBrowser(paneId: string, initialUrl: string) {
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const iframeElRef = useRef<HTMLIFrameElement | null>(null);

  const currentUrl = history[historyIndex];
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const navigate = useCallback((url: string) => {
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(url);
      return newHistory;
    });
    setHistoryIndex((prev) => prev + 1);
    setIsLoading(true);
  }, [historyIndex]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex((prev) => prev - 1);
      setIsLoading(true);
    }
  }, [historyIndex]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex((prev) => prev + 1);
      setIsLoading(true);
    }
  }, [historyIndex, history.length]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    // Re-set the iframe src to trigger a reload
    if (iframeElRef.current) {
      iframeElRef.current.src = currentUrl;
    }
  }, [currentUrl]);

  const iframeRef = useCallback((node: HTMLIFrameElement | null) => {
    if (iframeElRef.current) {
      iframeElRef.current.removeEventListener('load', handleLoad);
    }
    iframeElRef.current = node;
    if (node) {
      node.addEventListener('load', handleLoad);
    }
  }, []);

  function handleLoad() {
    setIsLoading(false);
  }

  return {
    iframeRef,
    currentUrl,
    canGoBack,
    canGoForward,
    isLoading,
    navigate,
    goBack,
    goForward,
    refresh,
  };
}
