import { create } from "zustand";

interface ConnectionState {
  connected: boolean;
  reconnecting: boolean;
  connect: () => void;
  disconnect: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connected: false,
  reconnecting: false,

  connect: () => {
    set({ connected: true, reconnecting: false });
  },

  disconnect: () => {
    set({ connected: false, reconnecting: false });
  },
}));
