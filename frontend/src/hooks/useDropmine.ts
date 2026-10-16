import { useEffect, useState, useSyncExternalStore } from "react";
import { Dropmine } from "../services/DropmineService";

export function useDropmine() {
  const [service] = useState(() => new Dropmine());
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useEffect(() => {
    service.start();
    return service.stop;
  }, [service]);
  return { state, service };
}
