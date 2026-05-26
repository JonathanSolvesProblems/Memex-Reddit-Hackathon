import { useEffect, useState } from "react";
import type { InitResponse } from "../../shared/api";
import { api } from "../api";

type InitState = {
  data: InitResponse | null;
  error: string | null;
  loading: boolean;
};

/** Fetches the post classification + initial snapshot once on mount. */
export function useInit(): InitState {
  const [state, setState] = useState<InitState>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let alive = true;
    api
      .init()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: unknown) =>
        alive &&
        setState({
          data: null,
          error: e instanceof Error ? e.message : "Failed to load",
          loading: false,
        }),
      );
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
