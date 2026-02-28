import { useReducer, useCallback, useRef } from 'react';

interface BrowserState {
  history: string[];
  historyIndex: number;
  isLoading: boolean;
}

type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'goBack' }
  | { type: 'goForward' }
  | { type: 'refresh' }
  | { type: 'loaded' };

function browserReducer(state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case 'navigate': {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(action.url);
      return {
        history: newHistory,
        historyIndex: newHistory.length - 1,
        isLoading: true,
      };
    }
    case 'goBack':
      if (state.historyIndex <= 0) return state;
      return { ...state, historyIndex: state.historyIndex - 1, isLoading: true };
    case 'goForward':
      if (state.historyIndex >= state.history.length - 1) return state;
      return { ...state, historyIndex: state.historyIndex + 1, isLoading: true };
    case 'refresh':
      return { ...state, isLoading: true };
    case 'loaded':
      return { ...state, isLoading: false };
  }
}

export function useBrowser(paneId: string, initialUrl: string) {
  const [state, dispatch] = useReducer(browserReducer, {
    history: [initialUrl],
    historyIndex: 0,
    isLoading: true,
  });

  const iframeElRef = useRef<HTMLIFrameElement | null>(null);
  const handleLoadRef = useRef(() => dispatch({ type: 'loaded' }));

  const currentUrl = state.history[state.historyIndex];
  const canGoBack = state.historyIndex > 0;
  const canGoForward = state.historyIndex < state.history.length - 1;

  const navigate = useCallback((url: string) => {
    dispatch({ type: 'navigate', url });
  }, []);

  const goBack = useCallback(() => {
    dispatch({ type: 'goBack' });
  }, []);

  const goForward = useCallback(() => {
    dispatch({ type: 'goForward' });
  }, []);

  const refresh = useCallback(() => {
    dispatch({ type: 'refresh' });
    if (iframeElRef.current) {
      iframeElRef.current.src = currentUrl;
    }
  }, [currentUrl]);

  const iframeRef = useCallback((node: HTMLIFrameElement | null) => {
    if (iframeElRef.current) {
      iframeElRef.current.removeEventListener('load', handleLoadRef.current);
    }
    iframeElRef.current = node;
    if (node) {
      node.addEventListener('load', handleLoadRef.current);
    }
  }, []);

  return {
    iframeRef,
    currentUrl,
    canGoBack,
    canGoForward,
    isLoading: state.isLoading,
    navigate,
    goBack,
    goForward,
    refresh,
  };
}
