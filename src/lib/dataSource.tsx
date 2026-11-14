import { createContext, useContext } from 'react';
import type { AnimeDataSource } from '../types/contract';

/** Lets deep graph nodes (recommendation satellites) reach the data layer without prop drilling. */
const DataSourceContext = createContext<AnimeDataSource | null>(null);
export const DataSourceProvider = DataSourceContext.Provider;
export function useDataSource(): AnimeDataSource {
  const ds = useContext(DataSourceContext);
  if (!ds) throw new Error('DataSourceProvider missing');
  return ds;
}
