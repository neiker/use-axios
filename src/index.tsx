import * as React from 'react';

import DefaultAxios, {
  AxiosError,
  AxiosResponse,
  AxiosRequestConfig,
  AxiosInstance,
  AxiosPromise,
} from 'axios';

import * as LRU from 'lru-cache';

const REQUEST_START = 'REQUEST_START';
const REQUEST_END = 'REQUEST_END';

const ssrPromises: AxiosPromise<any>[] = [];

let cache: LRU<any, any>;
let axiosInstance: AxiosInstance;

export function resetConfigure(): void {
  cache = new LRU();
  axiosInstance = DefaultAxios;
}

resetConfigure();

export function configure(options: {
  axios?: AxiosInstance;
  cache?: LRU<any, any>;
}): void {
  if (options.axios) {
    axiosInstance = options.axios;
  }

  if (options.cache) {
    ({ cache } = options);
  }
}

export function loadCache(data: any): void {
  cache.load(data);
}

export async function serializeCache(): Promise<any> {
  await Promise.all(ssrPromises);

  ssrPromises.length = 0;

  return cache.dump();
}

async function cacheAdapter({
  adapter,
  ...config
}: AxiosRequestConfig): Promise<any> {
  const cacheKey = JSON.stringify(config);
  const hit = cache.get(cacheKey);

  if (hit) {
    return hit;
  }

  const response = await axiosInstance(config);

  const responseForCache = { ...response };
  delete responseForCache.config;
  delete responseForCache.request;

  cache.set(cacheKey, responseForCache);

  return response;
}

function createInitialState<T, E>(options: Options): State<T, E> {
  return {
    loading: !options.manual,
  };
}

interface State<T, E> {
  loading: boolean;
  response?: AxiosResponse<T>;
  error?: AxiosError<E>;
}

interface ActionStart {
  type: typeof REQUEST_START;
}

interface ActionSuccess<T> {
  type: typeof REQUEST_END;
  error: false;
  payload: AxiosResponse<T>;
}

interface ActionError<E> {
  type: typeof REQUEST_END;
  error: true;
  payload: AxiosError<E>;
}

type Action<T, E> = ActionStart | ActionSuccess<T> | ActionError<E>;

function reducer<T, E>(state: State<T, E>, action: Action<T, E>): State<T, E> {
  switch (action.type) {
    case REQUEST_START:
      return {
        ...state,
        loading: true,
        error: undefined,
      };
    case REQUEST_END:
      return {
        ...state,
        loading: false,
        [action.error ? 'error' : 'response']: action.payload,
      };
    default:
      return state;
  }
}

async function request<T, E>(
  config: AxiosRequestConfig,
  dispatch: React.Dispatch<Action<T, E>>,
): Promise<void> {
  try {
    dispatch({
      type: REQUEST_START,
    });

    const response = await axiosInstance(config);

    dispatch({
      type: REQUEST_END,
      payload: response,
      error: false,
    });
  } catch (err) {
    dispatch({
      type: REQUEST_END,
      payload: err,
      error: true,
    });
  }
}

function executeRequestWithCache<T, E>(
  config: AxiosRequestConfig,
  dispatch: React.Dispatch<Action<T, E>>,
): void {
  request(
    {
      ...config,
      adapter: cacheAdapter,
    },
    dispatch,
  );
}

function executeRequestWithoutCache<T, E>(
  config: AxiosRequestConfig,
  dispatch: React.Dispatch<Action<T, E>>,
): void {
  request(config, dispatch);
}

interface ResponseValues<T, E> {
  loading: boolean;
  error?: AxiosError<E>;
  response?: AxiosResponse<T>;
}

interface Options {
  manual?: boolean;
  useCache?: boolean;
}

interface ExecuteOptions {
  useCache?: boolean;
}

const defaultOptions: Options = {
  manual: false,
  useCache: true,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function useAxios<T = any, E = any>(
  configOrString: AxiosRequestConfig | string,
  options: Options = defaultOptions,
): [
  ResponseValues<T, E>,
  (config?: AxiosRequestConfig, options?: ExecuteOptions) => void,
] {
  const config =
    typeof configOrString === 'string'
      ? { url: configOrString }
      : configOrString;

  const [state, dispatch] = React.useReducer<
    React.Reducer<State<T, E>, Action<T, E>>
  >(reducer, createInitialState<T, E>(options));

  if (typeof window === 'undefined') {
    ssrPromises.push(
      axiosInstance({
        ...config,
        adapter: cacheAdapter,
      }),
    );
  }

  React.useEffect(() => {
    if (!options.manual) {
      if (options.useCache) {
        executeRequestWithCache(config, dispatch);
      } else {
        executeRequestWithoutCache(config, dispatch);
      }
    }
  }, [config, options.manual, options.useCache]);

  const execute = React.useCallback(
    (configOverride: AxiosRequestConfig, executeOptions: ExecuteOptions = { useCache: false }) => {
      const configWithOverride = {
        ...config,
        ...configOverride,
      };

      if (executeOptions.useCache) {
        executeRequestWithCache(configWithOverride, dispatch);
      } else {
        executeRequestWithoutCache(configWithOverride, dispatch);
      }
    },
    [config],
  );

  return [state, execute];
}
