import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";

type CallControlContextValue = {
  /** Ask the current page to start a call. If no handler is mounted yet, the request is queued. */
  requestCall: () => void;
  /** Registers the active call-start handler. CallPanel uses this. Returns an unregister function. */
  registerCallHandler: (handler: () => void) => () => void;
};

const CallControlContext = createContext<CallControlContextValue | null>(null);

export function CallControlProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef(false);

  const registerCallHandler = useCallback((handler: () => void) => {
    handlerRef.current = handler;
    if (pendingRef.current) {
      pendingRef.current = false;
      handler();
    }
    return () => {
      handlerRef.current = null;
    };
  }, []);

  const requestCall = useCallback(() => {
    if (handlerRef.current) {
      handlerRef.current();
    } else {
      pendingRef.current = true;
    }
  }, []);

  return (
    <CallControlContext.Provider
      value={{ requestCall, registerCallHandler }}
    >
      {children}
    </CallControlContext.Provider>
  );
}



export function useCallControl() {
  const ctx = useContext(CallControlContext);
  if (!ctx) {
    throw new Error(
      "useCallControl must be used within a CallControlProvider",
    );
  }
  return ctx;
}
